// docs/design/vips/0001-effect-and-async-functions.md#d509fa16dd5857bc
// VIP-1: each banned legacy form has an editor quick fix
// run-seconds: 180
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Connection } from "../../lsp-connection.mjs"
const here = path.dirname(fileURLToPath(import.meta.url))
const server = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vip1-legacy-quickfix-"))
fs.writeFileSync(path.join(directory, "tsconfig.json"), fs.readFileSync(path.join(here, "tsconfig.json")))
fs.symlinkSync(path.join(here, "node_modules"), path.join(directory, "node_modules"), "dir")
const probes = [
  ["eval-direct", 'export function f() { return eval("1") }'],
  ["eval-indirect", 'export function f() { return (0, eval)("1") }'],
  ["function-new", 'export const f = new Function("return 1")'],
  ["function-call", 'export const f = Function("return 1")'],
  ["function-alias", 'export const f = Function'],
  ["arguments", 'export function f() { return arguments.length }'],
  ["var", 'export function f() { var n = 1; return n }'],
  ["with", 'export function f() { with ({}) {} }'],
]
for (const [name, text] of probes) fs.writeFileSync(path.join(directory, name + ".vibe"), text + "\n")
const connection = new Connection(server, ["--lsp", "--stdio"], directory, { requestTimeoutMs: 20000 })
const failures = []
try {
  const rootUri = pathToFileURL(directory).href
  await connection.request("initialize", {
    processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: "vip1-legacy-quickfix" }],
    capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: {
      diagnostic: { dynamicRegistration: false }, codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix"] } } }
    }, workspace: { configuration: true, workspaceEdit: { documentChanges: true } } }
  })
  connection.notify("initialized", {})
  for (const [name, text] of probes) {
    const uri = pathToFileURL(path.join(directory, name + ".vibe")).href
    connection.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vibe", version: 1, text } })
    const report = await connection.request("textDocument/diagnostic", { textDocument: { uri } })
    const diagnostic = report.items.find(d => d.source === "EK" && d.code === 107 && d.severity === 1)
    if (!diagnostic) { failures.push(name + ": no EK0107 error; " + JSON.stringify(report.items)); continue }
    const actions = await connection.request("textDocument/codeAction", {
      textDocument: { uri }, range: diagnostic.range, context: { diagnostics: [diagnostic], only: ["quickfix"] }
    })
    if (!(actions ?? []).some(a => a.edit || a.command)) failures.push(name + ": no actionable quick fix")
  }
  assert.deepEqual(failures, [])
  console.log("legacy quick fixes")
} finally {
  await connection.close()
  fs.rmSync(directory, { recursive: true, force: true })
}
