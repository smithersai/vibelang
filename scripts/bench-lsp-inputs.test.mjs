import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const script = fileURLToPath(new URL("./bench/lsp.mjs", import.meta.url))

// Exhaust the four independent artifact groups in each source language.
// Only m0..m3 in the selected language are benchmark inputs.
for (const extension of [".vibe", ".ts"]) for (let mask = 0; mask < 16; mask++) {
  test("LSP benchmark selects " + extension + " source modules with artifact mask " + mask, t => {
    const root = mkdtempSync(join(tmpdir(), "vibelang bench inputs-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const project = join(root, "project")
    const src = join(project, "src")
    mkdirSync(src, { recursive: true })
    for (let i = 0; i < 4; i++) {
      writeFileSync(join(src, "m" + i + extension), "export function run" + i + "() { return run" + (i - 1) + "() }\n")
    }
    const groups = [
      ["m0.d.vibe.ts", "m1.d.ts", "m9.d.ts"],
      ["m0.js", "m1.js.map", "m3" + extension + ".map"],
      ["m9.tsbuildinfo", "m11" + extension + ".bak"],
      extension === ".vibe" ? ["m7.ts", "m8.tsx"] : ["m7.tsx", "m8.jsx"]
    ]
    for (let i = 0; i < groups.length; i++) if (mask & (1 << i)) {
      for (const name of groups[i]) writeFileSync(join(src, name), "artifact\n")
    }
    const trace = join(root, "trace.jsonl")
    const server = join(root, "server")
    writeFileSync(server, "#!" + process.execPath + "\n" + [
      'import { appendFileSync } from "node:fs"',
      'let buffer = Buffer.alloc(0)',
      'process.stdin.on("data", chunk => {',
      '  buffer = Buffer.concat([buffer, chunk])',
      '  for (;;) {',
      '    const end = buffer.indexOf("\\r\\n\\r\\n"); if (end < 0) return',
      '    const length = Number(/Content-Length: (\\d+)/.exec(buffer.subarray(0, end).toString())[1])',
      '    if (buffer.length < end + 4 + length) return',
      '    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length)); buffer = buffer.subarray(end + 4 + length)',
      '    appendFileSync(process.env.BENCH_INPUT_TRACE, JSON.stringify(message) + "\\n")',
      '    if (message.method === "exit") process.exit(0)',
      '    if (message.id === undefined) continue',
      '    const result = message.method === "textDocument/diagnostic" ? {items: []} : message.method === "textDocument/hover" ? {contents: "hover"} : null',
      '    const body = JSON.stringify({jsonrpc: "2.0", id: message.id, result})',
      '    process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body)',
      '  }',
      '})'
    ].join("\n"))
    chmodSync(server, 0o755)
    const result = spawnSync(process.execPath, [script, server, project, "1"], {
      encoding: "utf8", env: { ...process.env, BENCH_INPUT_TRACE: trace },
      timeout: 10_000, killSignal: "SIGKILL"
    })
    assert.equal(result.error, undefined, result.stderr)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /^project 4 modules: diagnostics/)
    const calls = readFileSync(trace, "utf8").trim().split("\n").map(JSON.parse)
    const opened = calls.filter(call => call.method === "textDocument/didOpen")
    assert.deepEqual(opened.map(call => call.params.textDocument.uri), [3, 2].map(i => pathToFileURL(join(src, "m" + i + extension)).href))
    assert.ok(opened.every(call => call.params.textDocument.languageId === (extension === ".vibe" ? "vibelang" : "typescript")))
    assert.equal(calls.filter(call => call.method === "textDocument/hover").length, 2)
    assert.ok(calls.some(call => call.method === "shutdown"))
  })
}
