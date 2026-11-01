import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"

const script = fileURLToPath(new URL("./bench/lsp.mjs", import.meta.url))

for (const ext of [".vibe", ".ts"]) {
  for (let count = 2; count <= 8; count++) {
    test("LSP warm diagnostics open another source file: " + count + ext, t => {
      const root = mkdtempSync(join(tmpdir(), "vibelang warm lsp-"))
      const pidFile = join(root, "peer.pid")
      t.after(() => {
        if (existsSync(pidFile)) {
          try { process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL") } catch {}
        }
        rmSync(root, {recursive: true, force: true})
      })
      const project = join(root, "benchmark project")
      mkdirSync(join(project, "src"), {recursive: true})
      for (let i = 0; i < count; i++) {
        const prev = i - 1
        writeFileSync(join(project, "src/m" + i + ext),
          (i ? 'import { run' + prev + ' } from "./m' + prev + ext + '"\n' : "") +
          "export function run" + i + "() { return " + (i ? "run" + prev + "()" : "0") + " }\n")
      }
      const peer = join(root, "peer.mjs")
      const trace = join(root, "trace.jsonl")
      writeFileSync(peer, "#!" + process.execPath + "\n" + [
        'import { appendFileSync, writeFileSync } from "node:fs"',
        'writeFileSync(process.env.WARM_PEER_PID, String(process.pid))',
        'let buffer = Buffer.alloc(0)',
        'process.stdin.on("data", chunk => {',
        '  buffer = Buffer.concat([buffer, chunk])',
        '  for (;;) {',
        '    const end = buffer.indexOf("\\r\\n\\r\\n"); if (end < 0) return',
        '    const length = Number(/Content-Length: (\\d+)/.exec(buffer.subarray(0, end).toString())[1])',
        '    if (buffer.length < end + 4 + length) return',
        '    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length)); buffer = buffer.subarray(end + 4 + length)',
        '    appendFileSync(process.env.WARM_PEER_TRACE, JSON.stringify(message) + "\\n")',
        '    if (message.method === "exit") process.exit(0)',
        '    if (message.id === undefined) continue',
        '    const result = message.method === "textDocument/diagnostic" ? {items: []} : message.method === "textDocument/hover" ? {contents: "fixture hover"} : null',
        '    const body = JSON.stringify({jsonrpc: "2.0", id: message.id, result})',
        '    process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body)',
        '  }',
        '})'
      ].join("\n"), {mode: 0o700})
      const result = spawnSync(process.execPath, [script, peer, project, "2"], {
        env: {...process.env, WARM_PEER_PID: pidFile, WARM_PEER_TRACE: trace},
        encoding: "utf8", timeout: 10_000, killSignal: "SIGKILL"
      })
      assert.equal(result.error, undefined, result.stderr)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.ok(result.stdout.startsWith("benchmark project " + count + " modules: diagnostics cold "), result.stdout)
      const calls = readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line))
      const pulls = calls.filter(call => call.method === "textDocument/diagnostic")
      assert.equal(pulls.length, 2)
      assert.notEqual(pulls[0].params.textDocument.uri, pulls[1].params.textDocument.uri,
        "cold and warm measurements must pull diagnostics from different source files")
      const expected = [count - 1, count === 2 ? 0 : Math.floor(count / 2)].map(i =>
        pathToFileURL(join(project, "src/m" + i + ext)).href)
      assert.deepEqual(pulls.map(call => call.params.textDocument.uri), expected)
      assert.deepEqual(calls.filter(call => call.method === "textDocument/didOpen").map(call => call.params.textDocument.uri), expected)
      assert.equal(calls.filter(call => call.method === "textDocument/hover").length, 3)
      assert.ok(calls.some(call => call.method === "shutdown"))
      assert.equal(calls.at(-1).method, "exit")
    })
  }
}
