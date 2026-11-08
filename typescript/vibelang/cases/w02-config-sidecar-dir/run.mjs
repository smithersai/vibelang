// run-seconds: 360
// Where the compatibility sidecar of app/src/user.vibe lands for each
// sidecarDir spelling, with app/tsconfig.json as the selected config.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { spawnSync } from "node:child_process"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const roots = []
const compilerOptions = {
  target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], lib: ["esnext"],
  skipLibCheck: true, rootDir: "${configDir}"
}
const walk = (root, dir = root) => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? walk(root, join(dir, entry.name)) : [relative(root, join(dir, entry.name))])

function build(base, app = { extends: "../configs/base.json", include: ["src"] }) {
  const root = mkdtempSync(join(tmpdir(), "w02-sidecar-dir-"))
  roots.push(root)
  mkdirSync(join(root, "configs"))
  mkdirSync(join(root, "app/src"), { recursive: true })
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  writeFileSync(join(root, "configs/base.json"), JSON.stringify(base))
  writeFileSync(join(root, "app/tsconfig.json"), JSON.stringify(app))
  writeFileSync(join(root, "app/src/user.vibe"), "export const one: number = 1\n")
  const run = spawnSync(binary, ["-p", "app/tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 120000 })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.equal(run.stdout, "", "no diagnostics")
  const shown = spawnSync(binary, ["-p", "app/tsconfig.json", "--showConfig"], { cwd: root, encoding: "utf8", timeout: 120000 })
  assert.equal(shown.status, 0, shown.stdout + shown.stderr)
  return { sidecars: walk(root).filter(f => f.endsWith(".d.vibe.ts")), vibe: JSON.parse(shown.stdout).vibe }
}

try {
  // Absent by default: the sidecar sits beside its source, and the effective
  // configuration names no sidecarDir.
  const absent = build({ compilerOptions })
  assert.deepEqual(absent.sidecars, ["app/src/user.d.vibe.ts"])
  assert.equal(absent.vibe?.sidecarDir, undefined)
  console.log("no sidecarDir: " + JSON.stringify(absent.sidecars) + ", showConfig vibe.sidecarDir " + absent.vibe?.sidecarDir)

  // A relative path resolves from the config that declares it: the base.
  const inherited = build({ compilerOptions, vibe: { sidecarDir: "decl" } })
  assert.deepEqual(inherited.sidecars, ["configs/decl/src/user.d.vibe.ts"])
  console.log("base sidecarDir \"decl\": " + JSON.stringify(inherited.sidecars) + ", showConfig " + JSON.stringify(inherited.vibe.sidecarDir))

  // ${configDir} resolves from the selected config, even when inherited.
  const selected = build({ compilerOptions, vibe: { sidecarDir: "${configDir}/decl" } })
  assert.deepEqual(selected.sidecars, ["app/decl/src/user.d.vibe.ts"])
  console.log("base sidecarDir \"${configDir}/decl\": " + JSON.stringify(selected.sidecars) + ", showConfig " + JSON.stringify(selected.vibe.sidecarDir))

  // A relative path declared by the selected config resolves from it.
  const own = build({ compilerOptions }, { extends: "../configs/base.json", include: ["src"], vibe: { sidecarDir: "decl" } })
  assert.deepEqual(own.sidecars, ["app/decl/src/user.d.vibe.ts"])
  console.log("app sidecarDir \"decl\": " + JSON.stringify(own.sidecars))

  // The value is a string: other JSON types are wrong-typed vibe values.
  for (const value of [true, 1, null, ["decl"]]) {
    const root = mkdtempSync(join(tmpdir(), "w02-sidecar-dir-"))
    roots.push(root)
    writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
    writeFileSync(join(root, "user.vibe"), "export const one: number = 1\n")
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions, files: ["user.vibe"], vibe: { sidecarDir: value } }))
    const run = spawnSync(binary, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 120000 })
    assert.deepEqual([...run.stdout.matchAll(/\): (error|warning) ((?:EK|TS)\d+)/g)].map(m => m[1] + " " + m[2]), ["error EK3007"], JSON.stringify(value) + "\n" + run.stdout)
  }
  console.log("non-string sidecarDir (true, 1, null, array): error EK3007")
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}
