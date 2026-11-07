// run-seconds: 120
// The EK0703 quick fixes: a singleton list offers `when X:` and `when X(let e):`;
// an empty list offers `when X:`. Applying either one clears the warning.
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Connection } from "../../lsp-connection.mjs"
const here = path.dirname(fileURLToPath(import.meta.url))
const server = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "w01-extractor-arity-quickfix-"))
fs.writeFileSync(path.join(directory, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, noEmit: true }, include: ["*.vibe"] }))
fs.writeFileSync(path.join(directory, "package.json"), '{"type":"module"}')
fs.symlinkSync(path.join(here, "node_modules"), path.join(directory, "node_modules"), "dir")
const probes = [
  ["error-empty", 'error NotFound { id: string }\nexport function f(e: unknown) { return match (e) { when NotFound(): 1; default: 0; } }', "NotFound", true],
  ["error-pair", 'error NotFound { id: string }\nexport function f(e: unknown) { return match (e) { when NotFound(let a, let b): 1; default: 0; } }', "NotFound", true],
  ["some-empty", 'import { Option } from "effect"\nexport function f(o: Option.Option<number>) { return match (o) { when Option.Some(): 1; default: 0; } }', "Option.Some", true],
  ["none-one", 'import { Option } from "effect"\nexport function f(o: Option.Option<number>) { return match (o) { when Option.None(let a): 1; default: 0; } }', "Option.None", false],
]
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const connection = new Connection(server, ["--lsp", "--stdio"], directory, { requestTimeoutMs: 20000 })
const failures = []
try {
  const rootUri = pathToFileURL(directory).href
  await connection.request("initialize", {
    processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: "w01-extractor-arity-quickfix" }],
    capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: {
      diagnostic: { dynamicRegistration: false }, codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix"] } } }
    }, workspace: { configuration: true, workspaceEdit: { documentChanges: true } } }
  })
  connection.notify("initialized", {})
  for (const [name, text, matcher, singleton] of probes) {
    fs.writeFileSync(path.join(directory, name + ".vibe"), text + "\n")
    const uri = pathToFileURL(path.join(directory, name + ".vibe")).href
    connection.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vibe", version: 1, text } })
    const report = await connection.request("textDocument/diagnostic", { textDocument: { uri } })
    const diagnostic = report.items.find(d => d.source === "EK" && d.code === 703)
    if (!diagnostic) { failures.push(name + ": no EK0703; " + JSON.stringify(report.items)); continue }
    const actions = await connection.request("textDocument/codeAction", {
      textDocument: { uri }, range: diagnostic.range, context: { diagnostics: [diagnostic], only: ["quickfix"] }
    })
    const offset = position => text.split("\n").slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character
    const applied = (actions ?? []).flatMap(action => {
      const edits = action?.edit?.changes?.[uri] ?? action?.edit?.documentChanges?.flatMap(change => change.edits ?? []) ?? []
      if (!edits.length) return []
      let fixed = text
      for (const edit of [...edits].sort((a, b) => offset(b.range.start) - offset(a.range.start))) {
        fixed = fixed.slice(0, offset(edit.range.start)) + edit.newText + fixed.slice(offset(edit.range.end))
      }
      return [fixed]
    })
    const bare = new RegExp("when " + escape(matcher) + "\\s*:")
    const bound = new RegExp("when " + escape(matcher) + "\\(let [A-Za-z_$][\\w$]*\\)\\s*:")
    if (!applied.some(fixed => bare.test(fixed))) failures.push(name + ": no quick fix writes when " + matcher + ":")
    if (singleton && !applied.some(fixed => bound.test(fixed))) failures.push(name + ": no quick fix writes when " + matcher + "(let e):")
    if (!singleton && applied.some(fixed => bound.test(fixed))) failures.push(name + ": an empty list offers a binding quick fix")
  }
  assert.deepEqual(failures, [])
  console.log("EK0703 quick fixes write when X: and, for a singleton list, when X(let e):")
} finally {
  await connection.close()
  fs.rmSync(directory, { recursive: true, force: true })
}
