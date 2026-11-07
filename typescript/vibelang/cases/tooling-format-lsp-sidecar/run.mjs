// The language server prefers an in-program ./x.vibe to its stale
// x.d.vibe.ts, adjacent or relocated by vibe.sidecarDir (007-tooling.md,
// Formatting and existing tools). The stale sidecar declares value() as a
// string and an extra export, stale(); the source declares value(): number.
// run-seconds: 120
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { Connection } from "../../lsp-connection.mjs"
import { baseOptions } from "../_tooling-witness.mjs"

const stale = "export declare function value(): string;\nexport declare function stale(): number;\n"
const consumer = 'import { value, stale } from "./lib.vibe"\nexport const n: number = value()\nexport const s: number = stale()\n'
// Each consumer's diagnostics: only TS2305 for the export the source lacks.
// Reading the sidecar would instead report TS2322 at line 2.
const want = ["0,16 TS2305 Module '\"./lib.vibe\"' has no exported member 'stale'."]

async function check(label, vibe, sidecar, source = true) {
  const dir = mkdtempSync(join(tmpdir(), "tooling-format-lsp-"))
  const put = (file, text) => { mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), text) }
  mkdirSync(join(dir, "node_modules"))
  symlinkSync(join(process.env.EFFECT_NODE_MODULES, "effect"), join(dir, "node_modules/effect"))
  symlinkSync(process.env.VIBELANG_RUNTIME, join(dir, "node_modules/vibelang-runtime"))
  put("package.json", '{"type":"module"}')
  put("tsconfig.json", JSON.stringify({ compilerOptions: { ...baseOptions(), noEmit: true, allowImportingTsExtensions: true, allowArbitraryExtensions: true, ...vibe.rootDirs }, include: ["*.vibe", "*.ts"], vibe: vibe.vibe }))
  if (source) put("lib.vibe", "export function value(): number { return 1 }\n")
  put(sidecar, stale)
  const files = [["consumer.ts", "typescript"], ["consumer.vibe", "vibe"]].slice(0, source ? 2 : 1)
  for (const [file] of files) put(file, consumer)
  const connection = new Connection(process.env.VIBELANG_BINARY, ["--lsp", "--stdio"], dir, { requestTimeoutMs: 30000 })
  try {
    const rootUri = pathToFileURL(dir).href
    await connection.request("initialize", { processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: "lsp-sidecar" }],
      capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: { diagnostic: { dynamicRegistration: false }, definition: {}, hover: {} }, workspace: { configuration: true } } })
    connection.notify("initialized", {})
    for (const [file, languageId] of files) {
      const uri = pathToFileURL(join(dir, file)).href
      connection.notify("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text: consumer } })
      const report = await connection.request("textDocument/diagnostic", { textDocument: { uri } })
      const seen = report.items.map(d => `${d.range.start.line},${d.range.start.character} ${d.source === "EK" ? "EK" : "TS"}${d.code} ${d.message}`)
      if (!source) {
        // Control: with no source in the program the TypeScript consumer
        // reads the sidecar, so its stale types are visible.
        assert.deepEqual(seen, ["1,13 TS2322 Type 'string' is not assignable to type 'number'."], `${label} ${file}`)
        continue
      }
      assert.deepEqual(seen, want, `${label} ${file}`)
      // value() at line 2 resolves to the source, never the sidecar.
      const at = { textDocument: { uri }, position: { line: 1, character: 26 } }
      const definition = await connection.request("textDocument/definition", at)
      assert.deepEqual(definition.map(l => l.uri), [pathToFileURL(join(dir, "lib.vibe")).href], `${label} ${file}`)
      const hover = await connection.request("textDocument/hover", at)
      assert.match(JSON.stringify(hover.contents), /value\(\): number/, `${label} ${file}`)
    }
  } finally {
    await connection.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

await check("adjacent", {}, "lib.d.vibe.ts")
await check("sidecar only", {}, "lib.d.vibe.ts", false)
await check("relocated", { vibe: { sidecarDir: "types" }, rootDirs: { rootDirs: [".", "types"] } }, "types/lib.d.vibe.ts")
console.log("the language server reads the in-program x.vibe, not its stale sidecar")
