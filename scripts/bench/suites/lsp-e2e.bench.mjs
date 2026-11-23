#!/usr/bin/env node
// End-to-end headless LSP benchmark on a synthetic VibeLang project:
// measures initialize, cold diagnostics, warm diagnostics, and hover latency.
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath, pathToFileURL } from "node:url"
import { encodeFrame, FrameDecoder } from "../../../typescript/vibelang/lsp-framing.mjs"
import { machineInfo, parseBenchArgs, stats, writeResultJson } from "../lib/harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const nativeName = process.platform === "win32" ? "vibelang.exe" : "vibelang"
const compiler = process.env.VIBELANG
  ? path.resolve(process.env.VIBELANG)
  : existsSync(path.join(root, "packages/compiler/native", nativeName))
    ? path.join(root, "packages/compiler/native", nativeName)
    : path.join(root, "typescript/built/local/tsc")

if (!existsSync(compiler)) {
  console.error(`lsp-e2e.bench.mjs: missing compiler at ${compiler}`)
  process.exit(1)
}

const opts = parseBenchArgs(process.argv.slice(2))
const modules = 30
const hovers = 20

const work = mkdtempSync(path.join(os.tmpdir(), "vibelang-lsp-bench-"))
try {
  execFileSync("sh", [path.join(root, "scripts/bench/modules.sh"), work], { stdio: "pipe" })
  const synthDir = path.join(work, "synth")
  execFileSync(process.execPath, [path.join(root, "scripts/bench/gen-synthetic.mjs"), synthDir, String(modules), "chain"], { stdio: "pipe" })
  const project = path.join(synthDir, "vibelang")
  const src = path.join(project, "src")
  const last = path.join(src, `m${modules - 1}.vibe`)
  const other = path.join(src, `m${Math.floor(modules / 2)}.vibe`)
  const uri = (file) => pathToFileURL(file).href

  const startedAt = new Date().toISOString()
  const suiteStart = performance.now()

  const child = spawn(compiler, ["--lsp", "--stdio"], { cwd: project, stdio: ["pipe", "pipe", "pipe"] })
  const decoder = new FrameDecoder()
  let nextId = 1
  const pending = new Map()
  let stderr = ""
  child.stderr.on("data", (c) => { stderr = (stderr + c.toString("utf8")).slice(-4096) })
  const send = (msg) => child.stdin.write(encodeFrame(msg))
  child.stdout.on("data", (chunk) => {
    for (const msg of decoder.push(chunk)) {
      if (msg.method === undefined) {
        const entry = pending.get(msg.id)
        if (!entry) continue
        pending.delete(msg.id)
        clearTimeout(entry.timer)
        msg.error ? entry.reject(new Error(msg.error.message)) : entry.resolve(msg.result)
      } else if (msg.id !== undefined) {
        const result = msg.method === "workspace/configuration" ? msg.params.items.map(() => null) : null
        send({ jsonrpc: "2.0", id: msg.id, result })
      }
    }
  })
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, 90_000)
    pending.set(id, { timer, resolve, reject })
    send({ jsonrpc: "2.0", id, method, params })
  })
  const timed = async (fn) => {
    const t0 = performance.now()
    const res = await fn()
    return [performance.now() - t0, res]
  }
  const open = (file) => send({
    jsonrpc: "2.0",
    method: "textDocument/didOpen",
    params: { textDocument: { uri: uri(file), languageId: "vibelang", version: 1, text: readFileSync(file, "utf8") } }
  })

  try {
    const [initMs] = await timed(() => request("initialize", {
      processId: process.pid,
      rootUri: uri(project),
      workspaceFolders: [{ uri: uri(project), name: "bench" }],
      capabilities: { textDocument: { hover: { contentFormat: ["markdown", "plaintext"] }, diagnostic: { dynamicRegistration: false } }, workspace: { configuration: true } }
    }))
    send({ jsonrpc: "2.0", method: "initialized", params: {} })

    open(last)
    const [coldMs, firstDiag] = await timed(() => request("textDocument/diagnostic", { textDocument: { uri: uri(last) } }))
    const errors = (firstDiag?.items ?? []).filter((d) => d.severity === 1).length
    if (errors !== 0) throw new Error(`lsp-e2e: expected 0 errors, got ${errors}`)

    open(other)
    const [warmMs] = await timed(() => request("textDocument/diagnostic", { textDocument: { uri: uri(other) } }))

    const lines = readFileSync(last, "utf8").split("\n")
    const line = lines.findIndex((l) => l.includes(`run${modules - 2}(`))
    const character = lines[line].indexOf(`run${modules - 2}(`) + 1
    const hoverReq = () => request("textDocument/hover", { textDocument: { uri: uri(last) }, position: { line, character } })
    const [firstHoverMs, hoverRes] = await timed(hoverReq)
    if (!hoverRes) throw new Error("lsp-e2e: hover returned empty result")

    const hoverSamples = []
    for (let i = 0; i < hovers; i++) hoverSamples.push((await timed(hoverReq))[0])
    const hoverStats = stats(hoverSamples)

    await request("shutdown").catch(() => {})
    send({ jsonrpc: "2.0", method: "exit" })
    child.stdin.end()

    const singleMetric = (name, ms) => ({
      name,
      unit: "ms/op",
      value: Number(ms.toFixed(2)),
      min: Number(ms.toFixed(2)),
      median: Number(ms.toFixed(2)),
      mean: Number(ms.toFixed(2)),
      p95: Number(ms.toFixed(2)),
      max: Number(ms.toFixed(2)),
      nsPerOp: ms * 1e6,
      samples: [Number(ms.toFixed(2))]
    })

    const benchmarks = [
      singleMetric(`initialize (${modules}mod)`, initMs),
      singleMetric(`diagnostics cold (${modules}mod)`, coldMs),
      singleMetric(`diagnostics warm (${modules}mod)`, warmMs),
      singleMetric(`hover first (${modules}mod)`, firstHoverMs),
      {
        name: `hover steady (${modules}mod, n=${hovers})`,
        unit: "ms/op",
        value: Number(hoverStats.median.toFixed(2)),
        min: Number(hoverStats.min.toFixed(2)),
        median: Number(hoverStats.median.toFixed(2)),
        mean: Number(hoverStats.mean.toFixed(2)),
        p95: Number(hoverStats.p95.toFixed(2)),
        max: Number(hoverStats.max.toFixed(2)),
        nsPerOp: hoverStats.median * 1e6,
        samples: hoverStats.samples.map((v) => Number(v.toFixed(2)))
      }
    ]

    const durationMs = performance.now() - suiteStart
    const payload = {
      schemaVersion: 1,
      suite: "lsp-e2e",
      category: "compiler-e2e",
      description: `Headless VibeLang LSP server initialize, cold/warm diagnostics, and hover latency (${modules} modules).`,
      startedAt,
      durationMs: Number(durationMs.toFixed(2)),
      machine: machineInfo(),
      meta: { modules, hovers },
      benchmarks
    }
    console.log(`\n[compiler-e2e] lsp-e2e (${durationMs.toFixed(0)} ms)`)
    for (const b of benchmarks) {
      console.log(`  ${b.name.padEnd(48)} ${b.value.toFixed(2).padStart(10)} ms/op`)
    }
    if (opts.out) writeResultJson(opts.out, payload)
  } finally {
    for (const entry of pending.values()) clearTimeout(entry.timer)
    child.kill()
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
