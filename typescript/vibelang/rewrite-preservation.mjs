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

export async function compareRewrite(url, expected, { mode = "fix", present = [], absent = [], editorClass = "Bad" } = {}) {
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
  if (mode === "editor") {
    fs.writeFileSync(source, await editorRewrite(compiler, work, source, original, editorClass))
  } else if (mode === "format") {
    // Exercise the actual process plugin with an import-sorting host. The
    // minimal host obeys the plugin's per-request TypeScript overrides.
    fs.writeFileSync(source, await formatRewrite(compiler, work, original))
  } else {
    command("fix", compiler, ["-p", ".", "--fix", "--pretty", "false"])
  }
  const rewritten = fs.readFileSync(source, "utf8")
  fs.writeFileSync(path.join(work, "before.vibe.txt"), original)
  fs.writeFileSync(path.join(work, "after.vibe.txt"), rewritten)
  command("compile-after", compiler, ["-p", ".", "--pretty", "false"])
  const after = command("run-after", process.execPath, ["out/main.js"])
  assert.equal(after, before, "rewrite changed application output")
  for (const text of present) assert.ok(rewritten.includes(text), "rewrite lost " + text)
  for (const text of absent) assert.ok(!rewritten.includes(text), "rewrite left " + text)
  if (mode === "format") {
    assert.equal(await formatRewrite(compiler, work, rewritten), rewritten, "format is not idempotent")
  } else {
    const second = command("fix-again", compiler, ["-p", ".", "--fix", "--pretty", "false"])
    assert.equal(fs.readFileSync(source, "utf8"), rewritten, "fix is not idempotent")
    assert.match(second, /0 fixes in 0 files/, "second fix did work")
  }
  process.stdout.write("rewrite preserves " + path.basename(dir).slice("rewrite-".length) + "\n")
}

async function editorRewrite(compiler, cwd, file, source, className) {
  const child = spawn(compiler, ["--lsp", "--stdio"], { cwd, stdio: ["pipe", "pipe", "pipe"] })
  const transcript = []
  let buffer = Buffer.alloc(0)
  let next = 1
  const pending = new Map()
  function send(value) {
    transcript.push({ send: value })
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...value }))
    child.stdin.write(Buffer.concat([Buffer.from("Content-Length: " + body.length + "\r\n\r\n"), body]))
  }
  child.stdout.on("data", (data) => {
    buffer = Buffer.concat([buffer, data])
    while (true) {
      const end = buffer.indexOf("\r\n\r\n")
      if (end < 0) return
      const size = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1])
      if (buffer.length < end + 4 + size) return
      const value = JSON.parse(buffer.subarray(end + 4, end + 4 + size))
      buffer = buffer.subarray(end + 4 + size)
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

// dprint process-plugin protocol, with an intentionally sorting TypeScript
// formatter. There are no VibeLang-only forms in this import-order fixture.
async function formatRewrite(compiler, cwd, source) {
  const child = spawn(compiler, ["--parent-pid", String(process.pid)], { cwd, stdio: ["pipe", "pipe", "pipe"] })
  let buffer = Buffer.alloc(0)
  let wake
  const stderr = []
  child.stderr.on("data", (chunk) => stderr.push(chunk))
  child.stdout.on("data", (data) => { buffer = Buffer.concat([buffer, data]); wake?.() })
  child.on("exit", () => wake?.())
  const read = async (n) => {
    while (buffer.length < n) {
      if (child.exitCode !== null) throw new Error("formatter exited: " + Buffer.concat(stderr))
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("formatter protocol timeout")), 25_000)
        wake = () => { clearTimeout(timer); wake = undefined; resolve() }
      })
    }
    const value = buffer.subarray(0, n); buffer = buffer.subarray(n); return value
  }
  const num = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
  const word = async () => (await read(4)).readUInt32BE()
  const sized = (s) => { const b = Buffer.from(s); return Buffer.concat([num(b.length), b]) }
  const text = async () => (await read(await word())).toString()
  const success = Buffer.from([255,255,255,255])
  const send = (...parts) => child.stdin.write(Buffer.concat(parts))
  const transcript = []
  try {
    send(num(0))
    assert.equal(await word(), 0)
    assert.equal(await word(), 5)
    send(num(1), num(7), num(1), sized("{}"), sized("{}"), success)
    await word(); assert.equal(await word(), 0); assert.equal(await word(), 1)
    assert.deepEqual(await read(4), success)
    send(num(2), num(13), sized("main.vibe"), num(0), num(Buffer.byteLength(source)), num(1), sized("{}"), sized(source), success)
    const hostID = await word()
    assert.equal(await word(), 16)
    assert.equal(await word(), 2)
    await text() // host path
    assert.equal(await word(), 0)
    await word() // range end
    const overrides = JSON.parse(await text())
    const encoded = await text()
    assert.deepEqual(await read(4), success)
    transcript.push({ overrides, encoded })
    let formatted = encoded
    if (overrides["module.sortImportDeclarations"] !== "maintain") {
      const lines = encoded.split("\n")
      const imports = lines.filter((line) => line.startsWith("import "))
      const sorted = [...imports].sort()
      let i = 0
      formatted = lines.map((line) => line.startsWith("import ") ? sorted[i++] : line).join("\n")
    }
    send(num(3), num(14), num(hostID), num(1), sized(formatted), success)
    await word()
    const kind = await word()
    assert.equal(await word(), 2)
    if (kind === 2) throw new Error(await text())
    assert.equal(kind, 14)
    const changed = await word()
    const result = changed ? await text() : source
    assert.deepEqual(await read(4), success)
    return result
  } finally {
    fs.writeFileSync(path.join(cwd, "format-transcript.json"), JSON.stringify(transcript, null, 2))
    child.kill()
  }
}
