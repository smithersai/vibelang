// run-seconds: 240
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const stock = require.resolve("../../../../experiments/node_modules/typescript/bin/tsc")
assert.equal(require("../../../../experiments/node_modules/typescript/package.json").version, "5.9.3")
const root = mkdtempSync(join(tmpdir(), "witness07-sidecar-dir-"))
const options = {
  target: "ESNext", module: "ESNext", moduleResolution: "Bundler", types: [], skipLibCheck: true,
  declaration: true, emitDeclarationOnly: true, allowArbitraryExtensions: true, allowImportingTsExtensions: true,
}
const vibe = { effectGlobals: false, effectModules: false }
const x = "export const x = 1\n"

// One layout, two projects: `.vibe` sources with `vibe.sidecarDir`, and the
// `.ts` twin with `declarationDir` in its place. `tree` maps a relative path to
// file text or a config, written with `{ext}` and `{dir}` placeholders.
function layout(name, tree, args = ["-p", "."]) {
  const result = {}
  for (const ext of ["vibe", "ts"]) {
    const home = join(root, name, ext)
    for (const [file, value] of Object.entries(tree)) {
      const path = join(home, file.replaceAll("{ext}", ext))
      mkdirSync(dirname(path), { recursive: true })
      let text = value
      if (typeof value !== "string") {
        const { sidecarDir, ...compilerOptions } = value.compilerOptions
        const config = { ...value, compilerOptions: { ...options, ...compilerOptions } }
        if (ext === "vibe") config.vibe = sidecarDir === undefined ? vibe : { ...vibe, sidecarDir }
        else if (sidecarDir !== undefined) config.compilerOptions.declarationDir = sidecarDir
        text = JSON.stringify(config)
      }
      writeFileSync(path, text.replaceAll("{ext}", ext === "ts" ? "js" : "vibe"))
    }
    const run = ext === "vibe"
      ? spawnSync(process.env.VIBELANG_BINARY, [...args, "--pretty", "false"], { cwd: home, encoding: "utf8", timeout: 60_000 })
      : spawnSync(process.execPath, [stock, ...args, "--pretty", "false"], { cwd: home, encoding: "utf8", timeout: 60_000 })
    assert.ifError(run.error)
    const suffix = ext === "vibe" ? ".d.vibe.ts" : ".d.ts"
    const files = readdirSync(home, { recursive: true }).filter(file => file.endsWith(suffix))
      .map(file => file.replaceAll("\\", "/").slice(0, -suffix.length)).sort()
    const codes = [...new Set([...(run.stdout + run.stderr).matchAll(/error (TS\d+)/g)].map(m => m[1]))].sort()
    result[ext] = { status: run.status, codes, files }
  }
  assert.deepEqual(result.vibe, result.ts, name + ": sidecar layout equals stock declarationDir layout")
  return result.vibe
}

try {
  // rule-evidence: docs/design/vips/0027-declaration-output.md#142d4d9b6fd4cf2f
  // rule-evidence: docs/design/vips/0027-declaration-output.md#amendment-an-opt-in-sidecar-directory-2026-11-01 | `vibe.sidecarDir` moves every sidecar of the project into one directory, conventionally `.vibe/declarations`, at the source's path relative to TypeScript's declaration source root: explicit `rootDir`, the config directory for a composite project, or the common source directory otherwise.
  assert.deepEqual(layout("explicit-root", {
    "tsconfig.json": { compilerOptions: { rootDir: "src", sidecarDir: "decl" }, include: ["src"] },
    "src/a/x.{ext}": x,
  }).files, ["decl/a/x"])
  assert.deepEqual(layout("composite", {
    "tsconfig.json": { compilerOptions: { composite: true, sidecarDir: "decl" }, include: ["src"] },
    "src/a/x.{ext}": x,
  }).files, ["decl/src/a/x"])
  assert.deepEqual(layout("common-source", {
    "tsconfig.json": { compilerOptions: { sidecarDir: "decl" }, include: ["src"] },
    "src/a/x.{ext}": x,
    "src/a/b/y.{ext}": x,
  }).files, ["decl/b/y", "decl/x"])

  // rule-evidence: docs/design/vips/0027-declaration-output.md#f398c9a2d915af53
  // rule-evidence: docs/design/vips/0027-declaration-output.md#amendment-an-opt-in-sidecar-directory-2026-11-01 | With `rootDir: "."`, `src/x.vibe` gets `.vibe/declarations/src/x.d.vibe.ts`.
  assert.deepEqual(layout("root-dot", {
    "tsconfig.json": { compilerOptions: { rootDir: ".", rootDirs: [".", ".vibe/declarations"], sidecarDir: ".vibe/declarations" }, include: ["src"] },
    "src/x.{ext}": x,
  }).files, [".vibe/declarations/src/x"])

  // rule-evidence: docs/design/vips/0027-declaration-output.md#0749f7b4c18141d5
  // rule-evidence: docs/design/vips/0027-declaration-output.md#amendment-an-opt-in-sidecar-directory-2026-11-01 | An imported source outside the compiling config's directory follows that compiling project's root and `sidecarDir`; its nearest config does not change ownership.
  const outside = layout("imported-outside", {
    "a/tsconfig.json": { compilerOptions: { sidecarDir: "owner-decl" }, include: ["src"] },
    "a/src/x.{ext}": x,
    "b/tsconfig.json": { compilerOptions: { sidecarDir: "decl" }, include: ["src"] },
    "b/src/z.{ext}": 'export { x } from "../../a/src/x.{ext}"\n',
  }, ["-p", "b"])
  assert.deepEqual(outside, { status: 0, codes: [], files: ["b/decl/a/src/x", "b/decl/b/src/z"] })

  // rule-evidence: docs/design/vips/0027-declaration-output.md#c84e422c75926c19
  // rule-evidence: docs/design/vips/0027-declaration-output.md#amendment-an-opt-in-sidecar-directory-2026-11-01 | An explicit `rootDir` excluding it reports `TS6059`.
  const excluded = layout("outside-root-dir", {
    "a/src/x.{ext}": x,
    "b/tsconfig.json": { compilerOptions: { rootDir: "src", sidecarDir: "decl" }, include: ["src"] },
    "b/src/z.{ext}": 'export { x } from "../../a/src/x.{ext}"\n',
  }, ["-p", "b"])
  assert.deepEqual(excluded.codes, ["TS6059"])
  assert.notEqual(excluded.status, 0)

  // rule-evidence: docs/design/vips/0027-declaration-output.md#d836c4a76fc6e649
  // rule-evidence: docs/design/vips/0027-declaration-output.md#amendment-an-opt-in-sidecar-directory-2026-11-01 | With no `sidecarDir`, the sidecar stays beside its source.
  assert.deepEqual(layout("beside", {
    "tsconfig.json": { compilerOptions: {}, include: ["src"] },
    "src/a/x.{ext}": x,
    "src/a/b/y.{ext}": x,
  }).files, ["src/a/b/y", "src/a/x"])
  assert.deepEqual(layout("beside-imported", {
    "a/src/x.{ext}": x,
    "b/tsconfig.json": { compilerOptions: {}, include: ["src"] },
    "b/src/z.{ext}": 'export { x } from "../../a/src/x.{ext}"\n',
  }, ["-p", "b"]).files, ["a/src/x", "b/src/z"])
} finally {
  rmSync(root, { recursive: true, force: true })
}
console.log("sidecar directory layouts match TypeScript declarationDir")
