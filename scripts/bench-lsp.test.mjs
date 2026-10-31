import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"

const script = process.env.VIBELANG_BENCH_LSP_SCRIPT ?? fileURLToPath(new URL("./bench/lsp.mjs", import.meta.url))

for (const mode of ["success", "initialize-error", "diagnostic-error", "initialize-exit", "initialize-zero-exit", "initialize-noisy-exit", "initialize-slow-term", "initialize-ignore-term", "diagnostic-exit", "diagnostic-signal", "hover-exit", "stdout-close", "stdout-close-ignore-term", "stdin-close"]) {
  test("LSP benchmark owns its server: " + mode, async t => {
    const root = mkdtempSync(join(tmpdir(), "vibelang lsp bench-"))
    let peer
    t.after(() => {
      if (peer) {
        try { process.kill(peer, "SIGKILL") } catch {}
      }
      rmSync(root, { recursive: true, force: true })
    })
    const project = join(root, "benchmark project")
    mkdirSync(join(project, "src"), { recursive: true })
    for (let i = 0; i < 4; i++) writeFileSync(join(project, "src/m" + i + ".vibe"), "export function run" + i + "() { return run" + (i - 1) + "() }\n")
    const binary = join(root, "server")
    writeFileSync(binary, "#!" + process.execPath + "\n" + [
      'import { appendFileSync, closeSync, writeFileSync, writeSync } from "node:fs"',
      'writeFileSync(process.env.BENCH_PEER_PID, String(process.pid))',
      'setInterval(() => {}, 1000)',
      'if (process.env.BENCH_PEER_MODE === "stdout-close-ignore-term") process.on("SIGTERM", () => {})',
      'if (process.env.BENCH_PEER_MODE === "initialize-slow-term") process.on("SIGTERM", () => setTimeout(() => process.exit(0), 500))',
      'if (process.env.BENCH_PEER_MODE === "initialize-ignore-term") process.on("SIGTERM", () => {})',
      'let buffer = Buffer.alloc(0)',
      'const reply = body => { const text = JSON.stringify(body); process.stdout.write("Content-Length: " + Buffer.byteLength(text) + "\\r\\n\\r\\n" + text) }',
      'process.stdin.on("data", chunk => {',
      '  buffer = Buffer.concat([buffer, chunk])',
      '  for (;;) {',
      '    const end = buffer.indexOf("\\r\\n\\r\\n"); if (end < 0) return',
      '    const length = Number(/Content-Length: (\\d+)/.exec(buffer.subarray(0, end).toString())[1])',
      '    if (buffer.length < end + 4 + length) return',
      '    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length)); buffer = buffer.subarray(end + 4 + length)',
      '    appendFileSync(process.env.BENCH_PEER_TRACE, JSON.stringify(message) + "\\n")',
      '    const mode = process.env.BENCH_PEER_MODE',
      '    if (mode === "stdin-close" && message.method === "initialize") { process.stdin.destroy(); try { closeSync(0) } catch {}; reply({jsonrpc: "2.0", id: message.id, result: null}); return }',
      '    if (mode === "initialize-noisy-exit" && message.method === "initialize") { process.stderr.write("NOISE_START" + "x".repeat(256 * 1024), () => { writeSync(2, "fixture server stopped during initialize\\n"); process.exit(23) }); return }',
      '    if (mode === "initialize-zero-exit" && message.method === "initialize") { writeSync(2, "fixture server stopped during initialize\\n"); process.exit(0) }',
      '    if ((mode === "initialize-exit" && message.method === "initialize") || (mode === "diagnostic-exit" && message.method === "textDocument/diagnostic")) process.exit(23)',
      '    if (mode === "hover-exit" && message.method === "textDocument/hover") process.exit(23)',
      '    if (mode === "diagnostic-signal" && message.method === "textDocument/diagnostic") process.kill(process.pid, "SIGTERM")',
      '    if (mode.startsWith("stdout-close") && message.method === "textDocument/diagnostic") { process.stdout.end(); return }',
      '    if (message.method === "exit") process.exit(0)',
      '    if (message.id === undefined) continue',
      '    const failing = process.env.BENCH_PEER_MODE.startsWith("initialize-") ? "initialize" : process.env.BENCH_PEER_MODE === "diagnostic-error" ? "textDocument/diagnostic" : null',
      '    if (message.method === failing) reply({jsonrpc: "2.0", id: message.id, error: {code: -32603, message: "fixture " + message.method + " failed"}})',
      '    else reply({jsonrpc: "2.0", id: message.id, result: message.method === "textDocument/diagnostic" ? {items: []} : message.method === "textDocument/hover" ? {contents: "fixture hover"} : null})',
      '  }',
      '})'
    ].join("\n"))
    chmodSync(binary, 0o755)
    const pidFile = join(root, "peer.pid")
    const trace = join(root, "trace.jsonl")
    const result = spawnSync(process.execPath, [script, binary, project, "2"], {
      env: { ...process.env, BENCH_PEER_PID: pidFile, BENCH_PEER_TRACE: trace, BENCH_PEER_MODE: mode },
      encoding: "utf8", timeout: 10_000, killSignal: "SIGKILL"
    })
    peer = Number(readFileSync(pidFile, "utf8"))
    assert.equal(result.error, undefined, result.stderr)
    const alive = () => {
      try { process.kill(peer, 0); return true } catch { return false }
    }
    for (let i = 0; i < 20 && alive(); i++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(alive(), false, "benchmark left its server running")
    peer = undefined
    const calls = readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line))
    assert.equal(calls[0].method, "initialize")
    assert.deepEqual(calls[0].params.workspaceFolders, [{ uri: pathToFileURL(project).href, name: "bench" }])
    if (mode === "success") {
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /^benchmark project 4 modules: diagnostics cold \d+ ms \(0 errors\), warm \d+ ms; hover first \d+ ms, median of 2 \d+\.\d ms; peak RSS (?:\d+ MiB|n\/a)\n$/)
      assert.equal(calls.filter(call => call.method === "textDocument/diagnostic").length, 2)
      assert.equal(calls.filter(call => call.method === "textDocument/hover").length, 3)
      assert.ok(calls.some(call => call.method === "shutdown"))
    } else {
      assert.equal(result.status, 1, result.stdout + result.stderr)
      if (mode.endsWith("-error") || mode === "initialize-slow-term" || mode === "initialize-ignore-term") assert.match(result.stderr, /fixture .* failed/)
      else {
        const method = mode.startsWith("initialize-") ? "initialize" : mode === "hover-exit" ? "textDocument/hover" : "textDocument/diagnostic"
        assert.ok(result.stderr.includes(method), result.stderr)
        assert.match(result.stderr, /request \d+/)
        if (mode.endsWith("-exit")) assert.match(result.stderr, mode === "initialize-zero-exit" ? /code 0/ : /code 23/)
        else if (mode.endsWith("-signal")) assert.match(result.stderr, /SIGTERM/)
        else if (mode === "stdin-close") assert.match(result.stderr, /stdin failed \(EPIPE\)/)
        else {
          assert.match(result.stderr, /stdout closed/)
          if (mode === "stdout-close-ignore-term") assert.match(result.stderr, /SIGKILL/)
        }
      }
      if (["initialize-zero-exit", "initialize-noisy-exit"].includes(mode)) assert.match(result.stderr, /fixture server stopped during initialize/)
      if (mode === "initialize-noisy-exit") {
        assert.ok(result.stderr.length < 12_000, "stderr evidence must stay bounded")
        assert.doesNotMatch(result.stderr, /NOISE_START/)
      }
      assert.equal(result.stdout, "")
    }
  })
}

test("LSP benchmark reports a server spawn failure without waiting for its request deadline", () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang lsp missing-"))
  try {
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "src/m0.vibe"), "export const value = 1\n")
    const result = spawnSync(process.execPath, [script, join(root, "missing-server"), root, "2"], {
      encoding: "utf8", timeout: 10_000, killSignal: "SIGKILL"
    })
    assert.equal(result.error, undefined, result.stderr)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.equal(result.stdout, "")
    assert.match(result.stderr, /request 1.*initialize/)
    assert.match(result.stderr, /ENOENT/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
