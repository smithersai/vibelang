import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { pathAliases, renameBatch, restoreSpecifiers, rewriteImports } from "../lib/codemod.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const compiler = process.env.VIBELANG_BINARY
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-alias-rewrite-options.json", import.meta.url), "utf8"))
const write = (root, files) => {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
}
function fixture({ flag, inherited = false, name = "a", prefix = "@/", kind = ".ts", index = false } = { flag: true }) {
  const root = mkdtempSync(join(tmpdir(), "opencode-alias-options-"))
  const module = "src/" + name + (index ? "/index" : "") + ".ts"
  const importer = "src/app/view" + kind
  const original = 'import { x } from "' + prefix + name + '"; export const answer = x\n'
  const options = { module: "Preserve", moduleResolution: "Bundler", target: "ES2022", rootDir: ".", allowArbitraryExtensions: true, allowImportingTsExtensions: true, paths: { [prefix + "*"]: ["./missing/*", "./src/*"] }, ...(flag === undefined ? {} : { rewriteRelativeImportExtensions: flag }) }
  const project = inherited ? { "tsconfig.base.json": JSON.stringify({ compilerOptions: options }), "tsconfig.json": '{"extends":"./tsconfig.base.json","include":["src/**/*"]}' } : { "tsconfig.json": JSON.stringify({ compilerOptions: options, include: ["src/**/*"] }) }
  write(root, { ...project, "package.json": '{"type":"module"}', [module]: "export const x = 42\n", [importer]: original })
  const [renamed] = renameBatch(root, [module])
  const sidecar = renamed.to.replace(/\.vibe$/, ".d.vibe.ts")
  write(root, { [sidecar]: "export declare const x = 42;\n" })
  return { root, module, importer, original, renamed, sidecar, options }
}
function exercise(input = {}) {
  const f = fixture(input)
  try {
    const aliases = pathAliases(ts, f.root)
    const edits = rewriteImports(f.root, [f.importer, f.renamed.to], [f.renamed.to], aliases)
    assert.equal(edits.length, 1)
    const next = edits[0].to
    assert.equal(next.startsWith("."), input.flag !== false && input.flag !== undefined)
    const parsed = ts.getParsedCommandLineOfConfigFile(join(f.root, "tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} })
    assert.equal(parsed.options.rewriteRelativeImportExtensions, input.flag)
    const resolved = ts.resolveModuleName(next, join(f.root, f.importer), parsed.options, ts.sys).resolvedModule
    assert.equal(resolved?.resolvedFileName, join(f.root, f.sidecar))
    // Restore after the module has returned to TypeScript, like the flow.
    renameSync(join(f.root, f.renamed.to), join(f.root, f.module))
    if (f.importer.endsWith(".vibe")) rewriteImports(f.root, [f.importer, f.module], [f.module], aliases)
    else restoreSpecifiers(f.root, edits, f.module, aliases)
    if (!f.importer.endsWith(".vibe")) assert.equal(readFileSync(join(f.root, f.importer), "utf8"), f.original)
    else assert.ok(!readFileSync(join(f.root, f.importer), "utf8").includes(".vibe"))
  } finally { rmSync(f.root, { recursive: true, force: true }) }
}
test("opencode-54: rewrite options select a relative migrated alias and revert records its original", () => exercise({ flag: true }))
test("alias spelling preserves configured options and module identity over forward/revert cycles", () => {
  fc.assert(fc.property(fc.constantFrom(true, false, undefined), fc.boolean(), fc.constantFrom("a", "composer/schema"), fc.constantFrom("@/", "~/", "#app/"), fc.constantFrom(".ts", ".mts", ".tsx", ".vibe"), fc.boolean(), (flag, inherited, name, prefix, kind, index) => exercise({ flag, inherited, name, prefix, kind, index })), { seed: 540054, numRuns: 200 })
})
test("opencode's TS2877 witness compiles and its emitted runtime keeps the same module", { skip: !compiler && "set VIBELANG_BINARY" }, () => {
  const root = mkdtempSync(join(tmpdir(), "opencode-ts2877-"))
  try {
    write(root, corpus.files)
    const before = spawnSync(compiler, ["-p", "tsconfig.json", "--noEmit", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8" })
    assert.equal(before.status, 0, before.stdout + before.stderr)
    const nativeRuntime = spawnSync("bun", ["src/b.ts"], { cwd: root, encoding: "utf8" })
    assert.equal(nativeRuntime.status, 0, nativeRuntime.stderr)
    assert.equal(nativeRuntime.stdout.trim(), "42")
    const aliases = pathAliases(ts, root)
    const [renamed] = renameBatch(root, ["src/a.ts"])
    const edits = rewriteImports(root, ["src/b.ts", renamed.to], [renamed.to], aliases)
    const result = spawnSync(compiler, ["-p", "tsconfig.json", "--outDir", "out", "--noEmit", "false", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.deepEqual(edits, [{ file: "src/b.ts", from: "@/a", to: "./a.vibe" }])
    const js = readFileSync(join(root, "out/src/b.js"), "utf8")
    assert.ok(js.includes("./a.js"), js)
    const run = spawnSync(process.execPath, [join(root, "out/src/b.js")], { cwd: root, encoding: "utf8" })
    assert.equal(run.status, 0, run.stderr)
    assert.equal(run.stdout.trim(), "42")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("authored false and absent rewrite options retain accepted alias source names", { skip: !compiler && "set VIBELANG_BINARY" }, () => {
  for (const flag of [false, undefined]) for (const inherited of [false, true]) {
    const f = fixture({ flag, inherited })
    try {
      const aliases = pathAliases(ts, f.root)
      const edits = rewriteImports(f.root, [f.importer, f.renamed.to], [f.renamed.to], aliases)
      assert.equal(edits[0].to, "@/a.vibe")
      const result = spawnSync(compiler, ["-p", "tsconfig.json", "--noEmit", "--pretty", "false", "--singleThreaded"], { cwd: f.root, encoding: "utf8" })
      assert.equal(result.status, 0, result.stdout + result.stderr)
    } finally { rmSync(f.root, { recursive: true, force: true }) }
  }
})

test("alias rewriting follows the documented native-option contract", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes('When extension rewriting is enabled, a migrated paths alias uses a relative source name resolving to the same module.'))
})
