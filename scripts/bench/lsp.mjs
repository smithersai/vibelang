#!/usr/bin/env node
// Language server benchmark: opens the last module of a synthetic project
// (scripts/bench/gen-synthetic.mjs) and measures the time to its first pulled
// diagnostics, then hover latency at a call into the previous module.
//
//   node scripts/bench/lsp.mjs <server binary> <project dir> [hovers=20]
//
// <project dir> is the vibelang or effect-ts directory the generator wrote.
// Prints one line: cold diagnostics ms, warm diagnostics ms (another file),
// first hover ms, median hover ms, and the server's peak RSS (Linux only).
import { spawn } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const server = path.resolve(process.argv[2] ?? "")
const project = path.resolve(process.argv[3] ?? "")
const hovers = Number(process.argv[4] ?? 20)
const src = path.join(project, "src")
const ext = readdirSync(src).some((f) => f.endsWith(".vibe")) ? ".vibe" : ".ts"
const count = readdirSync(src).filter((f) => /^m\d+\./.test(f)).length
const last = path.join(src, `m${count - 1}${ext}`)
const other = path.join(src, `m${Math.floor(count / 2)}${ext}`)
const uri = (file) => pathToFileURL(file).href

// LSP_ARGS adds server arguments, such as "--pprofDir /tmp/prof".
const extra = (process.env.LSP_ARGS ?? "").split(" ").filter(Boolean)
const child = spawn(server, ["--lsp", "--stdio", ...extra], { cwd: project, stdio: ["pipe", "pipe", "pipe"] })
let buffer = Buffer.alloc(0)
let nextId = 1
const pending = new Map()
child.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n")
    if (end < 0) return
    const length = Number(/Content-Length: *(\d+)/i.exec(buffer.subarray(0, end).toString())?.[1])
    if (buffer.length < end + 4 + length) return
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString())
    buffer = buffer.subarray(end + 4 + length)
    if (message.method === undefined) {
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    } else if (message.id !== undefined) {
      const result = message.method === "workspace/configuration" ? message.params.items.map(() => null) : null
      send({ jsonrpc: "2.0", id: message.id, result })
    }
  }
})
function send(message) {
  const body = Buffer.from(JSON.stringify(message))
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
  child.stdin.write(body)
}
function request(method, params) {
  const id = nextId++
  send({ jsonrpc: "2.0", id, method, params })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 120_000)
    pending.set(id, (message) => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolve(message.result) })
  })
}
const open = (file) => send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri: uri(file), languageId: ext === ".vibe" ? "vibelang" : "typescript", version: 1, text: readFileSync(file, "utf8") } } })
async function timed(fn) {
  const start = performance.now()
  const result = await fn()
  return [performance.now() - start, result]
}

async function benchmark() {
  await request("initialize", {
    processId: process.pid,
    rootUri: uri(project),
    workspaceFolders: [{ uri: uri(project), name: "bench" }],
    capabilities: { textDocument: { hover: { contentFormat: ["markdown", "plaintext"] }, diagnostic: { dynamicRegistration: false } }, workspace: { configuration: true } }
  })
  send({ jsonrpc: "2.0", method: "initialized", params: {} })

  open(last)
  const [cold, first] = await timed(() => request("textDocument/diagnostic", { textDocument: { uri: uri(last) } }))
  open(other)
  const [warm] = await timed(() => request("textDocument/diagnostic", { textDocument: { uri: uri(other) } }))

  // Hover the call into the previous module's run function.
  const lines = readFileSync(last, "utf8").split("\n")
  const line = lines.findIndex((l) => l.includes(`run${count - 2}(`))
  const character = lines[line].indexOf(`run${count - 2}(`) + 1
  const hover = () => request("textDocument/hover", { textDocument: { uri: uri(last) }, position: { line, character } })
  const [firstHover, hoverResult] = await timed(hover)
  const samples = []
  for (let i = 0; i < hovers; i++) samples.push((await timed(hover))[0])
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)]

  let rss = "n/a"
  try {
    const status = readFileSync(`/proc/${child.pid}/status`, "utf8")
    rss = `${Math.round(Number(/VmHWM:\s+(\d+)/.exec(status)[1]) / 1024)} MiB`
  } catch {}
  const errors = (first?.items ?? []).filter((d) => d.severity === 1).length
  await request("shutdown").catch(() => {})
  send({ jsonrpc: "2.0", method: "exit" })
  child.stdin.end()
  console.log(`${path.basename(project)} ${count} modules: diagnostics cold ${cold.toFixed(0)} ms (${errors} errors), warm ${warm.toFixed(0)} ms; hover first ${firstHover.toFixed(0)} ms, median of ${hovers} ${median.toFixed(1)} ms${hoverResult ? "" : " (empty)"}; peak RSS ${rss}`)
}

try {
  await benchmark()
} catch (error) {
  child.kill()
  throw error
}
