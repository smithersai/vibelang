// run-seconds: 180
import assert from "node:assert/strict"
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"

assert.equal(ts.version, "5.9.3")
const here = fileURLToPath(new URL(".", import.meta.url))
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const stockTsc = fileURLToPath(new URL("../../../../docs/tools/node_modules/typescript/bin/tsc", import.meta.url))
const root = mkdtempSync(join(tmpdir(), "published-error-consumer-"))
const put = (name, text) => writeFileSync(join(root, name), text)
const options = { noEmit: true, strict: true, types: [], skipLibCheck: false, module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ES2022 }
function stock() {
  const program = ts.createProgram(["consumer.ts", "main.d.ts", "shadow.d.ts", "nested.d.ts", "plain.d.ts"].map(f => join(root, f)), options)
  // Isolation is part of the oracle, not merely a missing direct dependency.
  assert.ok(program.getSourceFiles().every(f => !f.fileName.includes("vibelang-runtime")))
  return ts.getPreEmitDiagnostics(program)
}
function compile(config) {
  put("tsconfig.json", JSON.stringify(config))
  const result = spawnSync(compiler, ["-p", root, "--pretty", "false"], { encoding: "utf8", timeout: 60_000 })
  assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr)
}
try {
  put("package.json", '{"type":"module"}')
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(join(here, "node_modules/effect")), join(root, "node_modules/effect"), "dir")
  assert.equal(existsSync(join(root, "node_modules/vibelang-runtime")), false)
  for (const file of ["main", "shadow", "nested", "plain"]) {
    for (const name of [file + ".d.vibe.ts", "out/" + file + ".d.ts"]) {
      const text = readFileSync(join(here, name), "utf8")
      assert.doesNotMatch(text, /reference types=["']vibelang-runtime|Symbol\.customMatcher|static \[/)
      // A shadowed Symbol formerly forced a runtime key import as well.
      assert.doesNotMatch(text, /from ["']vibelang-runtime["']/)
    }
    copyFileSync(join(here, "out", file + ".d.ts"), join(root, file + ".d.ts"))
    copyFileSync(join(here, "out", file + ".js"), join(root, file + ".js"))
  }
  copyFileSync(join(here, "consumer.ts"), join(root, "consumer.ts"))
  put("twin.ts", `import { Data, Schema } from "effect";
export class E extends Data.TaggedError("E")<{ readonly id: number }> {}
export class S extends Schema.TaggedError<S>()("S", { name: Schema.String }) {}
`)
  put("stock.json", JSON.stringify({ compilerOptions: { noEmit: true, strict: true, types: [], skipLibCheck: false, module: "NodeNext", target: "ES2022" }, files: ["consumer.ts", "main.d.ts", "shadow.d.ts", "nested.d.ts", "plain.d.ts"] }))
  const cli = spawnSync(process.execPath, [stockTsc, "-p", join(root, "stock.json"), "--pretty", "false"], { encoding: "utf8", timeout: 60_000 })
  assert.equal(cli.status, 0, cli.error?.message ?? cli.stdout + cli.stderr)
  let diagnostics = stock()
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: s => s, getCurrentDirectory: () => root, getNewLine: () => "\n" }))
  // Negative control: the removed reference really does break this environment.
  const declaration = readFileSync(join(root, "main.d.ts"), "utf8")
  put("main.d.ts", '/// <reference types="vibelang-runtime" />\n' + declaration)
  assert.ok(stock().some(d => d.code === 2688), "stock-only consumer must detect TS2688")
  put("main.d.ts", declaration)

  // A published package has no .vibe source or compatibility sidecar.
  // Only this VibeLang consumer installs the runtime.
  symlinkSync(realpathSync(join(here, "node_modules/vibelang-runtime")), join(root, "node_modules/vibelang-runtime"), "dir")
  put("client.vibe", `import { E, S } from "./main.js"
import { Shadow } from "./shadow.js"
import { Box } from "./nested.js"
export function data(value: unknown): number { return match(value) { when E: value.id; default: -1; } }
export function schema(value: unknown): string { return match(value) { when S: value.name; default: "miss"; } }
export function shadow(value: unknown): boolean { return match(value) { when Shadow: true; default: false; } }
export function nested(value: unknown): boolean { return match(value) { when Box.Nested: true; default: false; } }
export const protocol: symbol = Symbol.customMatcher
`)
  for (const effectModules of [false, true]) {
    compile({ compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, types: [], skipLibCheck: true, outDir: "build" }, files: ["client.vibe"], vibe: { effectModules, effectGlobals: effectModules } })
  }
  // Keep the published JavaScript beside the emitted client imports.
  for (const file of ["main", "shadow", "nested"]) copyFileSync(join(root, file + ".js"), join(root, "build", file + ".js"))
  const client = await import(pathToFileURL(join(root, "build/client.js")).href)
  assert.equal(client.data({ _tag: "E", id: 42 }), 42)
  assert.equal(client.data({ _tag: "Other", id: 42 }), -1)
  assert.equal(client.schema({ _tag: "S", name: "cross-copy" }), "cross-copy")
  assert.equal(client.schema({ _tag: "Other", name: "no" }), "miss")
  assert.equal(client.shadow({ _tag: "Shadow", id: 9 }), true)
  assert.equal(client.nested({ _tag: "Nested", id: 9 }), true)
  assert.equal(typeof client.protocol, "symbol")
  const { E, S } = await import(pathToFileURL(join(root, "main.js")).href)
  assert.equal(typeof E[Symbol.customMatcher], "function")
  assert.equal(typeof S[Symbol.customMatcher], "function")
} finally {
  rmSync(root, { recursive: true, force: true })
}
console.log("published declarations check without runtime; VibeLang matches published errors")

