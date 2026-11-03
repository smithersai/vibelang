import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Connection } from "../../../typescript/vibelang/lsp-connection.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing !== undefined && `build the compiler and runtime first; missing ${missing}`

function offset(source, position) {
  const lines = source.split("\n")
  return lines.slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character
}

function apply(source, edits) {
  return [...edits].sort((a, b) => offset(source, b.range.start) - offset(source, a.range.start)).reduce(
    (text, edit) => text.slice(0, offset(source, edit.range.start)) + edit.newText + text.slice(offset(source, edit.range.end)), source)
}

// VIP-1 keeps Promise adoption: even a primitive-typed then may be a getter.
// Exercise the real native LSP action and execute the positive repaired file.
test("async conversion preserves then getter reads and fresh data properties", { skip }, async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-async-then-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "esnext", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, outDir: "out" },
    include: ["*.vibe"]
  }))
  const cases = [
    ["fresh", "export async function load() { return { then: 7 } }", 1],
    ["getter", 'export async function load(events: string[]) { return { get then() { events.push("read"); return 7 } } }', 0],
    ["throwing-getter", "export async function load(error: Error) { return { get then(): number { throw error } } }", 0],
    ["alias", "export async function load(input: { then: number }) { return input }", 0]
  ]
  for (const [name, source] of cases) writeFileSync(join(root, name + ".vibe"), source)
  const connection = new Connection(native, ["--lsp", "--stdio"], root)
  try {
    const rootUri = pathToFileURL(root).href
    await connection.request("initialize", {
      processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: "async-then" }],
      capabilities: { general: { positionEncodings: ["utf-16"] }, textDocument: { diagnostic: {} }, workspace: { configuration: true, workspaceEdit: { documentChanges: true } } }
    })
    connection.notify("initialized", {})
    for (const [name, source, want] of cases) {
      await t.test(name, async () => {
        const uri = pathToFileURL(join(root, name + ".vibe")).href
        connection.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vibelang", version: 1, text: source } })
        await connection.request("textDocument/diagnostic", { textDocument: { uri } })
        const position = { line: 0, character: source.indexOf("async") }
        const actions = await connection.request("textDocument/codeAction", {
          textDocument: { uri }, range: { start: position, end: position }, context: { diagnostics: [] }
        })
        const conversions = (actions ?? []).filter((action) => action.title.startsWith("Convert to a VibeLang function"))
        assert.equal(conversions.length, want, name + ": Promise-adoption preservation")
        if (name !== "fresh") return
        let action = conversions[0]
        if (!action.edit) action = await connection.request("codeAction/resolve", action)
        const edits = action.edit?.changes?.[uri] ?? action.edit?.documentChanges?.find((change) => change.textDocument?.uri === uri)?.edits
        assert.ok(edits?.length, "fresh conversion has executable edits")
        const fixed = apply(source, edits)
        assert.match(fixed, /effect function load/)
        writeFileSync(join(root, "fresh.vibe"), fixed)
        connection.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: fixed }] })
        const compiled = spawnSync(native, ["--pretty", "false", "-p", "tsconfig.json"], { cwd: root, encoding: "utf8" })
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
        writeFileSync(join(root, "run.mjs"), 'import { Effect } from "effect"; import { load } from "./out/fresh.js"; console.log(JSON.stringify(Effect.runSync(load())))')
        const result = spawnSync(process.execPath, ["run.mjs"], { cwd: root, encoding: "utf8" })
        assert.equal(result.status, 0, result.stdout + result.stderr)
        assert.deepEqual(JSON.parse(result.stdout), { then: 7 })
      })
    }
  } finally {
    await connection.close()
  }
})
