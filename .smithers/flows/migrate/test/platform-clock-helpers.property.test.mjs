import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { splitPlatformToModule } from "../lib/platform.mjs"
import { materialize, restore, statements } from "./helpers/host-operations-oracle.mjs"

// A moved call's helper was typed `typeof crypto.randomUUID`. The compiler
// reports a host clock or randomness read by the declaration its call
// resolves to (VIP-33, appendix: the retired EK4403's reads are EK4402 "by
// resolved host origin"), so `$crypto_randomUUID()` still resolved to
// Crypto.randomUUID and stayed EK4402. These reads now get a body function
// with a signature of its own; other calls keep the callee's own type.

const runtime = new URL("../../../../packages/runtime/", import.meta.url)
const require = createRequire(new URL("package.json", runtime))
const ts = require("typescript"), fc = require("fast-check")
const compiler = process.env.VIBELANG_BINARY
const split = (text, globals) => splitPlatformToModule(text, "src/x.ts", ts, { globals })

const reads = [
  { call: "crypto.randomUUID()", globals: ["crypto"], helper: /^export function \$crypto_randomUUID\(\.\.\.args: Parameters<typeof crypto\.randomUUID>\): ReturnType<typeof crypto\.randomUUID> \{ return crypto\.randomUUID\(\.\.\.args\) \}$/m },
  { call: "performance.now()", globals: ["performance"], helper: /^export function \$performance_now\(\.\.\.args: Parameters<typeof performance\.now>\): ReturnType<typeof performance\.now> \{ return performance\.now\(\.\.\.args\) \}$/m },
  { call: "crypto.getRandomValues(new Uint8Array(4))", globals: ["crypto"], helper: /^export function \$crypto_getRandomValues<T extends Parameters<typeof crypto\.getRandomValues>\[0\]>\(array: T\): T \{ return crypto\.getRandomValues\(array\) \}$/m },
  { call: "globalThis.crypto.randomUUID()", globals: ["globalThis"], helper: /^export function \$globalThis_crypto_randomUUID\(\.\.\.args: Parameters<typeof globalThis\.crypto\.randomUUID>\)/m },
]

test("a clock or randomness read moves into a helper with its own signature", () => {
  for (const { call, globals, helper } of reads) {
    const source = `export const read = () => [${call}, import.meta.url];\nexport const value = 1;\n`
    const result = split(source, globals)
    assert.ok(result && !result.refused, call + JSON.stringify(result))
    assert.match(materialize(result.module).body, helper, call)
    assert.deepEqual(statements(restore(result.module)), statements(source), call)
  }
  // Any other host call keeps the callee's own type.
  const other = split('import { fileURLToPath } from "node:url";\nexport const here = fileURLToPath(new URL("./x", import.meta.url));\nexport const value = 1;\n', [])
  assert.match(materialize(other.module).body, /^export const \$fileURLToPath: typeof fileURLToPath = /m)
})

test("stock TypeScript types each read the same through its helper", () => {
  const root = mkdtempSync(join(tmpdir(), "clock-helpers-dts-"))
  try {
    const source = [
      "export const id = () => [crypto.randomUUID(), import.meta.url] as const;",
      "export const at = () => performance.now();",
      "export const bytes = () => crypto.getRandomValues(new Uint8Array(4));",
      ""].join("\n")
    const result = split(source, ["crypto", "performance"])
    assert.ok(result && !result.refused, JSON.stringify(result))
    const { body, module } = materialize(result.module, "./x.vibe.platform.ts")
    const options = { strict: true, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, types: [], skipLibCheck: true, declaration: true, emitDeclarationOnly: true, allowImportingTsExtensions: true }
    const emit = (text, name) => {
      writeFileSync(join(root, name + ".ts"), text)
      const program = ts.createProgram([join(root, name + ".ts")], options)
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], name)
      let declaration
      program.emit(undefined, (path, out) => { if (path.endsWith("/" + name + ".d.ts")) declaration = out })
      return declaration
    }
    const before = emit(source, "before")
    writeFileSync(join(root, "x.vibe.platform.ts"), body)
    assert.equal(emit(module, "after"), before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("reads in any position restore to the source", () => {
  // Each position also reads the module's URL, so the declaration stays in place.
  const positions = [(c) => `export const v = () => [${c}, import.meta.url];`, (c) => `export function f() { return [${c}, import.meta.url] }`, (c) => `export class K { readonly at = import.meta.url; get now() { return ${c} } }`]
  fc.assert(fc.property(fc.integer({ min: 0, max: reads.length - 1 }), fc.integer({ min: 0, max: positions.length - 1 }), (r, p) => {
    const source = `${positions[p](reads[r].call)}\nexport const value = 1;\n`
    const result = split(source, reads[r].globals)
    assert.ok(result && !result.refused, source + JSON.stringify(result))
    assert.deepEqual(statements(restore(result.module)), statements(source))
  }), { numRuns: 60, seed: 4402603 })
})

test("the compiler accepts the module and reports no platform code", { skip: !compiler && "set VIBELANG_BINARY" }, () => {
  const root = mkdtempSync(join(tmpdir(), "clock-helpers-native-"))
  try {
    mkdirSync(join(root, "src"))
    symlinkSync(join(runtime.pathname, "node_modules"), join(root, "node_modules"))
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "clock", private: true, type: "module" }))
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, module: "Preserve", moduleResolution: "Bundler", target: "ESNext", noEmit: true, skipLibCheck: true, types: [] }, include: ["src"] }))
    const result = split("export const id = () => [crypto.randomUUID(), performance.now(), crypto.getRandomValues(new Uint8Array(4)), import.meta.url];\nexport const value = 1;\n", ["crypto", "performance"])
    writeFileSync(join(root, "src/x.vibe"), result.module)
    const run = spawnSync(compiler, ["-p", "tsconfig.json", "--noEmit", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8" })
    assert.doesNotMatch(run.stdout + run.stderr, /EK4402/, run.stdout + run.stderr)
    assert.equal(run.status, 0, run.stdout + run.stderr)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
