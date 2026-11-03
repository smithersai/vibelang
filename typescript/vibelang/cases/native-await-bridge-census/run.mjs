// run-seconds: 180
// Spec: docs/design/src/002-running.md
// In the existing `async` context, suggest `await runPromise(Fiber.join(fiber))` or `await runPromise(Deferred.await(deferred))`.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Effect, Fiber, Deferred } from "effect"
import { Connection } from "../../lsp-connection.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const compiler = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "native-await-census-"))
const probes = [
  ["fiber", 4609, 'import { Fiber } from "effect";\nexport async function probe(f: Fiber.Fiber<number>) { return await f }'],
  ["deferred", 4610, 'import type { Deferred } from "effect";\nexport async function probe(d: Deferred.Deferred<number>) { return await d }']
]
fs.writeFileSync(path.join(directory, "tsconfig.json"), JSON.stringify({
  compilerOptions: { target: "es2022", lib: ["esnext", "dom"], module: "esnext", moduleResolution: "bundler",
    strict: true, declaration: true, types: [], outDir: "out" }, include: ["*.vibe"]
}))
fs.writeFileSync(path.join(directory, "package.json"), '{"type":"module"}')
fs.symlinkSync(path.join(here, "node_modules"), path.join(directory, "node_modules"), "dir")
for (const [name, , source] of probes) fs.writeFileSync(path.join(directory, name + ".vibe"), source)
const connection = new Connection(compiler, ["--lsp", "--stdio"], directory, { requestTimeoutMs: 20000 })

function compile() {
  const result = spawnSync(compiler, ["-p", directory, "--pretty", "false"], { encoding: "utf8", timeout: 30000 })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stdout + result.stderr)
}
function offset(source, position) {
  return source.split("\n").slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character
}
try {
  // The warning must leave native await's original result unchanged.
  compile()
  const fiber = await Effect.runPromise(Effect.forkDetach(Effect.succeed(7)))
  const deferred = await Effect.runPromise(Deferred.make())
  await Effect.runPromise(Deferred.succeed(deferred, 8))
  const handles = { fiber, deferred }
  for (const [name] of probes) {
    const original = await import(pathToFileURL(path.join(directory, "out", name + ".js")).href + "?original")
    assert.equal(await original.probe(handles[name]), handles[name])
  }
  const rootUri = pathToFileURL(directory).href
  await connection.request("initialize", {
    processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: "native-await-census" }],
    capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: {
      diagnostic: { dynamicRegistration: false }, codeAction: {
        codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix"] } }
      } }, workspace: { configuration: true, workspaceEdit: { documentChanges: true } } }
  })
  connection.notify("initialized", {})
  for (const [name, code, source] of probes) {
    const uri = pathToFileURL(path.join(directory, name + ".vibe")).href
    connection.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vibe", version: 1, text: source } })
    const report = await connection.request("textDocument/diagnostic", { textDocument: { uri } })
    const diagnostic = report.items.find(d => d.source === "EK" && d.code === code)
    assert.ok(diagnostic, JSON.stringify(report))
    const actions = await connection.request("textDocument/codeAction", {
      textDocument: { uri }, range: diagnostic.range, context: { diagnostics: [diagnostic], only: ["quickfix"] }
    })
    const repairs = (actions ?? []).filter(action => action.edit)
    assert.equal(repairs.length, 1, JSON.stringify(actions))
    const edit = repairs[0].edit
    const edits = edit.changes?.[uri] ?? edit.documentChanges?.flatMap(change => {
      assert.equal(change.textDocument.uri, uri)
      return change.edits
    })
    assert.ok(edits?.length)
    let fixed = source
    for (const change of edits.toSorted((a, b) => offset(source, b.range.start) - offset(source, a.range.start))) {
      fixed = fixed.slice(0, offset(source, change.range.start)) + change.newText + fixed.slice(offset(source, change.range.end))
    }
    assert.match(fixed, /async function probe/)
    assert.match(fixed, /return await /)
    assert.doesNotMatch(fixed, /return join\b/)
    fs.writeFileSync(path.join(directory, name + ".vibe"), fixed)
  }
  compile()
  for (const [name] of probes) {
    const declaration = fs.readFileSync(path.join(directory, "out", name + ".d.ts"), "utf8")
    assert.match(declaration, /Promise<number>/, declaration)
    const repaired = await import(pathToFileURL(path.join(directory, "out", name + ".js")).href + "?repaired")
    assert.equal(await repaired.probe(handles[name]), name === "fiber" ? 7 : 8)
  }
  assert.ok(Fiber.isFiber(fiber))
  console.log("native await census: Fiber and Deferred Promise bridges pass")
} finally {
  await connection.close()
  fs.rmSync(directory, { recursive: true, force: true })
}
