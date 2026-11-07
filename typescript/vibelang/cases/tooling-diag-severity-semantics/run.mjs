// run-seconds: 120
// Severity values for VibeLang's own warnings: "error" fails vibelang and
// vibelang lint and blocks emit under noEmitOnError; "warning" (the default)
// prints and exits 0; "suggestion" prints nowhere in the CLI and is a Hint
// in the language server; "off" reports nothing in the CLI, lint or the
// server, for own and imported codes alike. Setting an own warning to
// "error" is how CI fails on it.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { project, baseOptions } from "../_tooling-witness.mjs"
import { Connection } from "../../lsp-connection.mjs"

const appendix = readFileSync(new URL("../../../../docs/design/src/900-appendices.md", import.meta.url), "utf8")
const ownWarnings = [...appendix.matchAll(/^\| `(EK\d+)` \| (?:lint )?warning\b/gm)].map(m => m[1])
const imported = [...appendix.matchAll(/^\| `(EK38\d+)` \| `effecttsgo\//gm)].map(m => m[1])

// Three own warnings, one per statement: EK0508 (line 4), EK4609 (line 5),
// EK0801 (line 7).
const main = 'import type { Fiber } from "effect"\nerror Timeout\n' +
  "effect function slow(): never!Timeout { throw new Timeout() }\n" +
  "export effect function caught() { return slow() catch (e) => e }\n" +
  "export async function wait(fiber: Fiber.Fiber<number>) { return await fiber }\n" +
  "export effect function f() {\n  using x = { [Symbol.dispose]() {} }\n  return 1\n}\n"
const where = { EK0508: "main.vibe(4,", EK4609: "main.vibe(5,", EK0801: "main.vibe(7," }
const line = /^(\S+?\(\d+,)\d+\): (error|warning|suggestion) ((?:EK|TS)\d+)/gm
const printed = text => [...text.matchAll(line)].map(m => m[1] + " " + m[2] + " " + m[3])
const values = [undefined, "error", "warning", "suggestion", "off"]

for (const code of Object.keys(where)) for (const value of values) {
  const severities = value ? { [code]: value } : {}
  for (const noEmitOnError of [true, false]) project(({ put, invoke, exists }) => {
    put("main.vibe", main)
    put("tsconfig.json", { compilerOptions: { ...baseOptions(), noEmitOnError }, files: ["main.vibe"], vibe: { severities } })
    const label = code + " " + value + " noEmitOnError=" + noEmitOnError
    const others = Object.keys(where).filter(c => c !== code).map(c => where[c] + " warning " + c)
    const shown = value === "error" || value === "warning" || value === undefined ? [where[code] + " " + (value ?? "warning") + " " + code] : []
    const tsc = invoke("-p", ".", "--pretty", "false")
    assert.deepEqual(printed(tsc.text).sort(), [...others, ...shown].sort(), label + "\n" + tsc.text)
    // Only "error" changes the exit status, and under noEmitOnError the emit.
    assert.equal(tsc.status === 0, value !== "error", label + "\n" + tsc.text)
    assert.equal(exists("out/main.js"), !(value === "error" && noEmitOnError), label)
    if (!noEmitOnError) return
    const lint = invoke("lint", "-p", ".", "--pretty", "false")
    assert.deepEqual(printed(lint.text).sort(), [...others, ...shown].sort(), label + " lint\n" + lint.text)
    assert.equal(lint.status === 0, value !== "error", label + " lint\n" + lint.text)
  })
}

// "off" for every code: own warnings and imported EK38xx codes print nothing
// in the compiler or lint, though the project triggers both kinds.
const lint = 'import * as Effect from "effect/Effect"\nEffect.succeed(1)\nconst f = (e: string) => new Error(e)\n' +
  "export const g = Effect.gen(function* () {\n  const a = yield* Effect.fail(\"a\").pipe(Effect.mapError(f))\n" +
  "  const b = yield* Effect.fail(\"b\").pipe(Effect.mapError(f))\n  return [a, b]\n})\n"
const allOff = Object.fromEntries([...ownWarnings, ...imported].map(c => [c, "off"]))
const plugins = [{ name: "@effect/language-service" }]
project(({ put, invoke }) => {
  put("main.vibe", main)
  put("lint.ts", lint)
  put("tsconfig.json", { compilerOptions: { ...baseOptions(), noEmit: true, plugins }, files: ["main.vibe", "lint.ts"] })
  const before = printed(invoke("-p", ".", "--pretty", "false").text).map(d => d.split(" ").at(-1))
  for (const c of ["EK0508", "EK4609", "EK0801", "EK3801", "EK38100"]) assert.ok(before.includes(c), c + " " + before)
  put("tsconfig.json", { compilerOptions: { ...baseOptions(), noEmit: true, plugins }, files: ["main.vibe", "lint.ts"], vibe: { severities: allOff } })
  for (const args of [[], ["lint"]]) {
    const r = invoke(...args, "-p", ".", "--pretty", "false")
    assert.equal(r.text, "", args + "\n" + r.text)
    assert.equal(r.status, 0)
  }
})

// The language server: severity 1 error, 2 warning, 4 hint; nothing for "off".
const server = async (severities, files) => {
  const dir = mkdtempSync(join(tmpdir(), "severity-semantics-"))
  mkdirSync(join(dir, "node_modules"))
  symlinkSync(join(process.env.EFFECT_NODE_MODULES, "effect"), join(dir, "node_modules/effect"))
  symlinkSync(process.env.VIBELANG_RUNTIME, join(dir, "node_modules/vibelang-runtime"))
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { ...baseOptions(), noEmit: true, plugins }, files: Object.keys(files), vibe: { severities } }))
  const c = new Connection(process.env.VIBELANG_BINARY, ["--lsp", "--stdio"], dir, { requestTimeoutMs: 30000 })
  try {
    const rootUri = pathToFileURL(dir).href
    await c.request("initialize", { processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: "w" }], capabilities: { textDocument: { diagnostic: { dynamicRegistration: false } }, workspace: { configuration: true } } })
    c.notify("initialized", {})
    const out = []
    for (const [name, text] of Object.entries(files)) {
      const uri = pathToFileURL(join(dir, name)).href
      c.notify("textDocument/didOpen", { textDocument: { uri, languageId: name.endsWith(".vibe") ? "vibe" : "typescript", version: 1, text } })
      const report = await c.request("textDocument/diagnostic", { textDocument: { uri } })
      for (const d of report.items) out.push(name + ":" + (d.range.start.line + 1) + " " + d.source + String(d.code).padStart(4, "0") + " " + d.severity + (d.severity === 1 && d.source !== "EK" ? " " + d.message : ""))
    }
    // A clean TypeScript baseline: the project resolves.
    assert.ok(!out.some(d => / ts\d+ 1 /.test(d)), out.join("\n"))
    return out.filter(d => / EK/.test(d)).sort()
  } finally {
    await c.close()
    rmSync(dir, { recursive: true, force: true })
  }
}
const lspLine = { EK0508: "main.vibe:4", EK4609: "main.vibe:5", EK0801: "main.vibe:7" }
const severityOf = { error: 1, warning: 2, suggestion: 4 }
for (const value of ["error", "warning", "suggestion", "off"]) {
  // (Imported EK38xx suggestions on main.vibe are left out here.)
  const got = (await server(Object.fromEntries(Object.keys(lspLine).map(c => [c, value])), { "main.vibe": main })).filter(d => !/ EK38/.test(d))
  const want = value === "off" ? [] : Object.entries(lspLine).map(([c, at]) => at + " " + c + " " + severityOf[value]).sort()
  assert.deepEqual(got, want, value)
}
assert.deepEqual(await server(allOff, { "main.vibe": main, "lint.ts": lint }), [], "all off in the server")
console.log("own severities: error fails both commands and blocks noEmitOnError, warning exits 0, suggestion only in the server, off nowhere")
