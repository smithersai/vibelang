// docs/design/vips/0001-effect-and-async-functions.md#77a1eea5f1253075
// VIP-1: legacy restrictions include editor repairs
// docs/design/vips/0001-effect-and-async-functions.md#d509fa16dd5857bc
// VIP-1: each banned legacy form has an editor quick fix
// run-seconds: 180
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { Connection } from "../../lsp-connection.mjs"
const here = path.dirname(fileURLToPath(import.meta.url))
const server = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vip1-legacy-quickfix-"))
fs.writeFileSync(path.join(directory, "tsconfig.json"), fs.readFileSync(path.join(here, "tsconfig.json")))
fs.writeFileSync(path.join(directory, "package.json"), '{"type":"module"}')
fs.symlinkSync(path.join(here, "node_modules"), path.join(directory, "node_modules"), "dir")
const probes = [
  ["eval-direct", 'export function f() { return eval("1") }'],
  ["eval-indirect", 'export function f() { return (0, eval)("1") }'],
  ["function-new", 'export const f = new Function("return 1")'],
  ["function-call", 'export const f = Function("return 1")'],
  ["function-alias", 'export const f = Function'],
  ["arguments", 'export function f() { return arguments.length }'],
  ["var", 'export function f() { var n = 1; return n }'],
  ["eval-scope", 'export function f() { const n = 7; return eval("n") }'],
  ["var-hoist", 'export function f() { var n: number | undefined; const before = n; n = 1; return [before, n] }'],
  ["default-alias", 'var n = 1; export { n as default }; export function f() { return n }'],
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

    const action = (actions ?? []).find(a => a.title === "Write a TypeScript module for legacy JavaScript" || a.title === "Write an empty block instead of with")
    const edits = action?.edit?.changes?.[uri]
    if (!edits?.length) { failures.push(name + ": no preserving quick fix"); continue }
    const offset = position => {
      const lines = text.split("\n")
      return lines.slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character
    }
    let fixed = text
    for (const edit of [...edits].sort((a, b) => offset(b.range.start) - offset(a.range.start))) {
      fixed = fixed.slice(0, offset(edit.range.start)) + edit.newText + fixed.slice(offset(edit.range.end))
    }
    fs.writeFileSync(path.join(directory, name + ".vibe"), fixed)
    connection.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: fixed }] })
    const after = await connection.request("textDocument/diagnostic", { textDocument: { uri } })
    if (after.items.some(d => d.severity === 1)) failures.push(name + ": repair has errors; " + JSON.stringify(after.items))

  }
  assert.deepEqual(failures, [])

  const compile = spawnSync(server, ["-p", directory, "--pretty", "false"], { encoding: "utf8", timeout: 60000 })
  assert.equal(compile.status, 0, compile.stdout + compile.stderr)
  const reference = path.join(directory, "reference")
  fs.mkdirSync(reference)
  for (const [name, text] of probes) if (name !== "with") fs.writeFileSync(path.join(reference, name + ".ts"), text)
  fs.writeFileSync(path.join(reference, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [], outDir: "out" }, include: ["*.ts"] }))
  const require = createRequire(import.meta.url)
  const stock = require.resolve("../../../../experiments/node_modules/typescript/bin/tsc")
  assert.equal(require("../../../../experiments/node_modules/typescript/package.json").version, "5.9.3")
  const native = spawnSync(process.execPath, [stock, "-p", reference, "--pretty", "false"], { encoding: "utf8", timeout: 60000 })
  assert.equal(native.status, 0, native.stdout + native.stderr)
  for (const [name] of probes) {
    const fixed = await import(pathToFileURL(path.join(directory, "out", name + ".js")).href)
    if (name === "with") { assert.equal(fixed.f(), undefined); continue }
    const twin = await import(pathToFileURL(path.join(reference, "out", name + ".js")).href)
    assert.deepEqual(Object.keys(fixed).sort(), Object.keys(twin).sort(), name + ": export names changed")
    if ("default" in twin) assert.deepEqual(fixed.default, twin.default)
    if (name === "function-alias") assert.equal(fixed.f, twin.f)
    else assert.deepEqual(fixed.f(3, 4), twin.f(3, 4), name + ": native observation changed")
  }
  console.log("legacy quick fixes")

} finally {
  await connection.close()
  fs.rmSync(directory, { recursive: true, force: true })
}
