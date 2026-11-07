// rule-evidence: docs/design/src/007-tooling.md#imported-code-inventory | The generated table below and [`lint-codes.json`](https://github.com/smithersai/vibelang/blob/main/docs/design/inventory/lint-codes.json) assign one stable code per rule, even for a rule with several upstream messages.
// rule-evidence: docs/design/src/007-tooling.md#imported-code-inventory | CLI and editor print the code and rule name, for example `EK3801 floatingEffect: …`.
// runEffectInsideEffect has several upstream messages; both sites below get
// its one code, EK38104, in the compiler output and in the language server.
// run-seconds: 90
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { Connection } from "../../lsp-connection.mjs"
const here = path.dirname(fileURLToPath(import.meta.url))
const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "VIBELANG_BINARY must name the compiler")
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imported-code-printing-"))
fs.cpSync(path.join(here, "project"), dir, { recursive: true })
fs.symlinkSync(path.join(here, "node_modules"), path.join(dir, "node_modules"), "dir")
const floating = "floatingEffect: This Effect value is neither yielded nor used in an assignment."
const direct = "runEffectInsideEffect: `Effect.runSync` is called inside an existing Effect context."
const nested = "runEffectInsideEffect: `Effect.runSync` is called inside an Effect with a separate services invocation."
try {
  for (const args of [["-p", "tsconfig.json", "--pretty", "false"], ["-p", "tsconfig.json", "--pretty", "true"], ["lint", "-p", "tsconfig.json"]]) {
    const r = spawnSync(binary, args, { cwd: dir, encoding: "utf8", timeout: 30000 })
    const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, "")
    assert.equal(r.signal, null, out)
    for (const [code, text] of [["EK3801", floating], ["EK38104", direct], ["EK38104", nested]]) {
      assert.ok(out.includes(code + ": " + text), JSON.stringify(args) + " must print " + code + " with " + text + "\n" + out)
    }
    assert.equal(out.match(/EK38104/g)?.length, 2, out)
  }
  const connection = new Connection(binary, ["--lsp", "--stdio"], dir, { requestTimeoutMs: 30000 })
  try {
    const rootUri = pathToFileURL(dir).href
    await connection.request("initialize", { processId: process.pid, rootUri, workspaceFolders: [{ uri: rootUri, name: "printing" }], capabilities: { textDocument: { diagnostic: { dynamicRegistration: false } } } })
    connection.notify("initialized", {})
    const uri = pathToFileURL(path.join(dir, "probe.ts")).href
    connection.notify("textDocument/didOpen", { textDocument: { uri, languageId: "typescript", version: 1, text: fs.readFileSync(path.join(dir, "probe.ts"), "utf8") } })
    const report = await connection.request("textDocument/diagnostic", { textDocument: { uri } })
    const seen = report.items.map(d => [d.source + d.code, [floating, direct, nested].find(text => d.message.startsWith(text))])
    assert.deepEqual(seen, [["EK3801", floating], ["EK38104", direct], ["EK38104", nested]], JSON.stringify(report.items))
  } finally {
    await connection.close()
  }
  console.log("imported codes print with their rule names")
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
