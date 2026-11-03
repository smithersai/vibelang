import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
function fixture(t, { success, pending, symbol = "x" }) {
  const root = mkdtempSync(path.join(tmpdir(), "harness report "))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, "typescript/vibelang")
  const write = (file, text, options) => {
    const target = path.join(root, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, text, options)
  }
  write("typescript/package.json", '{"type":"module"}')
  mkdirSync(dir, { recursive: true })
  copyFileSync(process.env.HARNESS_REPORT_MODULE ?? path.join(here, "../typescript/vibelang/harness.mjs"), path.join(dir, "harness.mjs"))
  copyFileSync(path.join(here, "../typescript/vibelang/harness-command.mjs"), path.join(dir, "harness-command.mjs"))
  const payload = "BEGIN_REPORT\n" + symbol.repeat(400_000) + "\nEND_REPORT\n"
  write("payload", payload)
  write("typescript/built/local/tsc", `#!/usr/bin/env node
import fs from "node:fs"
fs.mkdirSync("out", { recursive: true })
fs.writeFileSync("out/main.js", 'console.log("42")')
if (process.env.REPORT_SUCCESS === "1") process.stdout.write(fs.readFileSync(process.env.REPORT_PAYLOAD))
`, { mode: 0o755 })
  write("typescript/vibelang/cases/report/main.ts", "export const value = 42\n")
  write("typescript/vibelang/cases/report/tsconfig.json", "{}")
  write("typescript/vibelang/cases/report/expected/stdout.txt", success ? "42\n" : payload)
  if (pending) write("typescript/vibelang/cases/report/pending", "report-fixture intentional output mismatch\n")
  write("runtime/package.json", '{"name":"vibelang-runtime","files":[]}')
  write("modules/effect/package.json", '{"name":"effect","version":"4.1.1"}')
  write("runtime/dist/index.js", "")
  return {
    harness: path.join(dir, "harness.mjs"), payload,
    env: { ...process.env, EFFECT_NODE_MODULES: path.join(root, "modules"), VIBELANG_RUNTIME: path.join(root, "runtime"), REPORT_PAYLOAD: path.join(root, "payload"), REPORT_SUCCESS: success ? "1" : "0" },
  }
}

for (const [name, options, args, verdict, exit] of [
  ["ordinary failure", {}, [], "0 ok, 1 FAIL, 0 pending, 0 XPASS", 1],
  ["verbose failure", { symbol: "漢" }, ["--verbose"], "0 ok, 1 FAIL, 0 pending, 0 XPASS", 1],
  ["verbose success", { success: true }, ["--verbose"], "1 ok, 0 FAIL, 0 pending, 0 XPASS", 0],
  ["ordinary emoji failure", { symbol: "🙂" }, [], "0 ok, 1 FAIL, 0 pending, 0 XPASS", 1],
  ["verbose pending failure", { pending: true }, ["--verbose"], "0 ok, 0 FAIL, 1 pending, 0 XPASS", 0],
  ["status failure control", {}, ["--status"], "0 ok, 1 FAIL, 0 pending, 0 XPASS", 1],
  ["quiet success control", { success: true }, [], "1 ok, 0 FAIL, 0 pending, 0 XPASS", 0],
]) {
  test(name + " drains the report before exiting", t => {
    const f = fixture(t, options)
    const result = spawnSync(process.execPath, [f.harness, ...args, "report"], {
      env: f.env, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
    })
    assert.ifError(result.error)
    assert.equal(result.status, exit, result.stderr)
    assert.ok(result.stdout.endsWith(`1 cases: ${verdict}\n`), "missing final verdict; captured " + Buffer.byteLength(result.stdout) + " bytes")
    if (args.includes("--verbose") || (!options.success && !args.includes("--status"))) {
      assert.ok(result.stdout.includes("END_REPORT"), "lost the diagnostic tail")
      assert.ok(result.stdout.includes(options.symbol ? options.symbol.repeat(400_000) : "x".repeat(400_000)), "lost report bytes or split a Unicode character")
    }
    if (!options.success) {
      const logFile = /log: +(.+?)(?:\)|$)/m.exec(result.stdout)?.[1]
      assert.ok(logFile, "failure report must name its retained log")
      const log = JSON.parse(readFileSync(logFile, "utf8"))
      assert.ok(log.detail)
      assert.equal(log.commands.length, 2)
    }
  })
}
