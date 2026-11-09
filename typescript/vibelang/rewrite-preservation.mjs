// Differential acceptance checks for source transformations. Every stage records
// its command, output and duration in out/rewrite-evidence, including failed rewrites.
// Each stage has 30 s; a case's run.mjs declares `// run-seconds: 180`, the sum of
// the six stages, so that the harness's runner deadline never fires before a
// stage's own, which names the stage (on loaded hosts the 60 s default killed
// healthy runs after four compiles).
import assert from "node:assert/strict"
import { spawnSync, spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { encodeFrame, FrameDecoder } from "./lsp-framing.mjs"

export async function compareRewrite(url, expected, { present = [], absent = [], editorClass = "Bad" } = {}) {
  const dir = path.dirname(fileURLToPath(url))
  assert.match(fs.readFileSync(fileURLToPath(url), "utf8"), /^\/\/ run-seconds: 180\b/m, "run.mjs must declare `// run-seconds: 180`: six stages of 30 s")
  const compiler = process.env.VIBELANG_REWRITE_BINARY || fileURLToPath(new URL("../built/local/tsc", import.meta.url))
  const work = path.join(dir, "out/rewrite-evidence")
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })
  for (const file of fs.readdirSync(dir)) {
    if (/\.(vibe|ts)$/.test(file) || file === "tsconfig.json" || file === "package.json") {
      fs.copyFileSync(path.join(dir, file), path.join(work, file))
    }
  }
  fs.symlinkSync(path.join(dir, "node_modules"), path.join(work, "node_modules"))
  function command(stage, bin, args) {
    const started = Date.now()
    const result = spawnSync(bin, args, { cwd: work, encoding: "utf8", timeout: 30_000, env: { ...process.env, NO_COLOR: "1" } })
    fs.writeFileSync(path.join(work, stage + ".log"), JSON.stringify({ bin, args, ms: Date.now() - started, status: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr }, null, 2))
    assert.equal(result.status, 0, stage + "\n" + result.stdout + result.stderr)
    return result.stdout
  }
  const source = path.join(work, "main.vibe")
  const original = fs.readFileSync(source, "utf8")
  command("compile-before", compiler, ["-p", ".", "--pretty", "false"])
  const before = command("run-before", process.execPath, ["out/main.js"])
  assert.equal(before, expected, "original behavior")
  fs.writeFileSync(source, await editorRewrite(compiler, work, source, original, editorClass))
  const rewritten = fs.readFileSync(source, "utf8")
  fs.writeFileSync(path.join(work, "before.vibe.txt"), original)
  fs.writeFileSync(path.join(work, "after.vibe.txt"), rewritten)
  command("compile-after", compiler, ["-p", ".", "--pretty", "false"])
  const after = command("run-after", process.execPath, ["out/main.js"])
  assert.equal(after, before, "rewrite changed application output")
  for (const text of present) assert.ok(rewritten.includes(text), "rewrite lost " + text)
  for (const text of absent) assert.ok(!rewritten.includes(text), "rewrite left " + text)
  process.stdout.write("rewrite preserves " + path.basename(dir).slice("rewrite-".length) + "\n")
}

async function editorRewrite(compiler, cwd, file, source, className) {
  const child = spawn(compiler, ["--lsp", "--stdio"], { cwd, stdio: ["pipe", "pipe", "pipe"] })
  const transcript = []
  const decoder = new FrameDecoder()
  let next = 1
  const pending = new Map()
  function send(value) {
    transcript.push({ send: value })
    child.stdin.write(encodeFrame({ jsonrpc: "2.0", ...value }))
  }
  child.stdout.on("data", (data) => {
    for (const value of decoder.push(data)) {
      transcript.push({ receive: value })
      if (value.method && value.id !== undefined) send({ id: value.id, result: value.method === "workspace/configuration" ? value.params.items.map(() => ({})) : null })
      else if (pending.has(value.id)) {
        pending.get(value.id)(value)
        pending.delete(value.id)
      }
    }
  })
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = next++
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("LSP timeout: " + method)) }, 25_000)
    pending.set(id, (value) => { clearTimeout(timer); resolve(value) })
    send({ id, method, params })
  })
  const uri = new URL("file://" + file).href
  try {
    await request("initialize", { processId: process.pid, rootUri: new URL("file://" + cwd).href, capabilities: {}, initializationOptions: { disableAutomaticTypingAcquisition: true } })
    send({ method: "initialized", params: {} })
    send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "vibelang", version: 1, text: source } } })
    const line = source.split("\n").findIndex((line) => line.includes("class " + className))
    const range = { start: { line, character: 6 }, end: { line, character: 6 + className.length } }
    const actions = await request("textDocument/codeAction", { textDocument: { uri }, range, context: { diagnostics: [{ range, severity: 2, code: 4830, source: "EK", message: className + " extends Data.TaggedError" }], only: ["quickfix"] } })
    const chosen = actions.result?.find((action) => action.title.startsWith("Write error"))
    assert.ok(chosen, JSON.stringify(actions))
    const offset = ({ line, character }) => source.split("\n").slice(0, line).reduce((n, text) => n + text.length + 1, 0) + character
    const edits = chosen.edit.changes[uri].map((edit) => ({ start: offset(edit.range.start), end: offset(edit.range.end), text: edit.newText })).sort((a, b) => b.start - a.start)
    for (const edit of edits) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end)
    return source
  } finally {
    fs.writeFileSync(path.join(cwd, "lsp-transcript.json"), JSON.stringify(transcript, null, 2))
    child.kill()
  }
}

