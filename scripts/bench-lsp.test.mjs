import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"

const script = fileURLToPath(new URL("./bench/lsp.mjs", import.meta.url))

for (const mode of ["success", "initialize-error", "diagnostic-error"]) {
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
      'import { appendFileSync, writeFileSync } from "node:fs"',
      'writeFileSync(process.env.BENCH_PEER_PID, String(process.pid))',
      'setInterval(() => {}, 1000)',
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
      '    if (message.method === "exit") process.exit(0)',
      '    if (message.id === undefined) continue',
      '    const failing = process.env.BENCH_PEER_MODE === "initialize-error" ? "initialize" : process.env.BENCH_PEER_MODE === "diagnostic-error" ? "textDocument/diagnostic" : null',
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
      assert.match(result.stderr, /fixture .* failed/)
      assert.equal(result.stdout, "")
    }
  })
}
