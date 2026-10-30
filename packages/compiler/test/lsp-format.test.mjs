import assert from "node:assert/strict"
import { test } from "node:test"
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createHash } from "node:crypto"
import { formatSource, typescriptPlugin } from "../format.mjs"

const root = fileURLToPath(new URL("../../..", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(root, "packages/compiler/native/vibelang")

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "vibe-lsp-format-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, "src"))
  const plugin = join(root, "packages/compiler/dprint-plugin.json")
  writeFileSync(join(dir, "dprint.json"), JSON.stringify({
    includes: ["**/*.vibe"],
    plugins: [typescriptPlugin, plugin + "@" + createHash("sha256").update(readFileSync(plugin)).digest("hex")],
    typescript: { quoteStyle: "alwaysSingle" }
  }))
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true }, include: ["src"] }))
  const path = join(dir, "src/main.vibe")
  writeFileSync(path, 'export const disk = "leave unchanged"\n')
  return { dir, path }
}
const unsaved = 'export function answer(){const label="😀";return label}\n'
const expected = "export function answer() {\n  const label = '😀'\n  return label\n}\n"

test("formatSource follows the repository's quote style for unsaved source", t => {
  const { path } = fixture(t)
  assert.equal(formatSource(unsaved, path), expected)
  assert.equal(readFileSync(path, "utf8"), 'export const disk = "leave unchanged"\n')
})

function connection(dir) {
  const child = spawn(binary, ["--lsp", "--stdio"], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] })
  let buffer = Buffer.alloc(0), next = 1, stderr = ""
  const pending = new Map()
  child.stderr.on("data", data => { stderr += data })
  const send = message => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }))
    child.stdin.write("Content-Length: " + body.length + "\r\n\r\n")
    child.stdin.write(body)
  }
  child.stdout.on("data", data => {
    buffer = Buffer.concat([buffer, data])
    for (;;) {
      const end = buffer.indexOf("\r\n\r\n")
      if (end < 0) return
      const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString())[1])
      if (buffer.length < end + 4 + length) return
      const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length))
      buffer = buffer.subarray(end + 4 + length)
      if (message.method && message.id !== undefined) {
        send({ id: message.id, result: message.method === "workspace/configuration" ? message.params.items.map(() => null) : null })
      } else if (pending.has(message.id)) {
        const { resolve, reject, timer } = pending.get(message.id)
        pending.delete(message.id); clearTimeout(timer)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else resolve(message.result)
      }
    }
  })
  child.on("error", error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error) } })
  return {
    notify: (method, params) => send({ method, params }),
    request(method, params) {
      const id = next++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + " timed out: " + stderr)) }, 60_000)
        pending.set(id, { resolve, reject, timer })
        send({ id, method, params })
      })
    },
    kill() { child.kill("SIGKILL"); for (const item of pending.values()) clearTimeout(item.timer) }
  }
}
function applyEdits(source, edits) {
  const offset = position => source.split("\n").slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character
  return [...(edits ?? [])].sort((a, b) => offset(b.range.start) - offset(a.range.start)).reduce(
    (text, edit) => text.slice(0, offset(edit.range.start)) + edit.newText + text.slice(offset(edit.range.end)), source)
}

test("LSP formatting uses the same configured formatter on the unsaved document", async t => {
  const { dir, path } = fixture(t)
  const client = connection(dir)
  t.after(() => client.kill())
  await client.request("initialize", { processId: process.pid, rootUri: pathToFileURL(dir).href, capabilities: {} })
  client.notify("initialized", {})
  const uri = pathToFileURL(path).href
  client.notify("textDocument/didOpen", { textDocument: { uri, languageId: "vibe", version: 1, text: unsaved } })
  const format = () => client.request("textDocument/formatting", { textDocument: { uri }, options: { tabSize: 2, insertSpaces: true } })
  const result = applyEdits(unsaved, await format())
  assert.equal(result, expected)
  const ranged = await client.request("textDocument/rangeFormatting", {
    textDocument: { uri }, options: { tabSize: 2, insertSpaces: true },
    range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }
  })
  assert.equal(applyEdits(unsaved, ranged), expected)
  assert.deepEqual(await client.request("textDocument/rangeFormatting", {
    textDocument: { uri }, options: { tabSize: 2, insertSpaces: true },
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }
  }), [])
  assert.equal(applyEdits(unsaved, await client.request("textDocument/onTypeFormatting", {
    textDocument: { uri }, options: { tabSize: 2, insertSpaces: true },
    position: { line: 0, character: unsaved.length - 1 }, ch: ";"
  })), expected)
  assert.equal(result, formatSource(unsaved, path))
  assert.equal(readFileSync(path, "utf8"), 'export const disk = "leave unchanged"\n')
  client.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text: result }] })
  assert.deepEqual(await format(), [])
  client.notify("textDocument/didChange", { textDocument: { uri, version: 3 }, contentChanges: [{ text: "export const broken = ;" }] })
  await assert.rejects(format(), /format|Expression|Unexpected/)
  assert.equal(readFileSync(path, "utf8"), 'export const disk = "leave unchanged"\n')
})

test("vibelang format uses the shared project formatter and check mode", t => {
  const { dir, path } = fixture(t)
  writeFileSync(path, unsaved)
  const launcher = process.env.VIBELANG_LAUNCHER || join(root, "packages/compiler/bin/vibelang")
  const run = (...args) => spawnSync(process.execPath, [launcher, "format", ...args, path],
    { cwd: dir, encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: binary } })
  let result = run("--check")
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.equal(readFileSync(path, "utf8"), unsaved)
  result = run("--write")
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(readFileSync(path, "utf8"), expected)
  assert.equal(run("--check").status, 0)
})

test("a dprint.json that registers only the TypeScript plugin still sets the style", t => {
  const { dir, path } = fixture(t)
  writeFileSync(join(dir, "dprint.json"), JSON.stringify({
    typescript: { quoteStyle: "alwaysSingle" },
    plugins: [typescriptPlugin]
  }))
  assert.equal(formatSource(unsaved, path), expected)
})

test("format command explains its options and rejects unknown switches without writing files", t => {
  const { dir, path } = fixture(t)
  const launcher = join(root, "packages/compiler/bin/vibelang")
  const run = (...args) => spawnSync(process.execPath, [launcher, "format", ...args],
    { cwd: dir, encoding: "utf8" })
  const before = readFileSync(path, "utf8")
  let result = run("--help")
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /vibelang format/)
  assert.match(result.stdout, /--check/)
  assert.match(result.stdout, /--write/)
  result = run("--unknown", path)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /unknown option.*--unknown/)
  assert.equal(readFileSync(path, "utf8"), before)
})
