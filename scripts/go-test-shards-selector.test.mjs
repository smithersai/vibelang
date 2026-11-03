import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const script = process.env.VIBELANG_SELECTOR_SCRIPT ?? fileURLToPath(new URL("./go-test-shards.sh", import.meta.url))
const realPaste = spawnSync("sh", ["-c", "command -v paste"], { encoding: "utf8" }).stdout.trim()
const peer = [
  "#!" + process.execPath,
  'import { appendFileSync } from "node:fs"',
  'const names = JSON.parse(process.env.SELECTOR_NAMES)',
  'if (process.argv.includes("-test.list")) { console.log(names.join("\\n")); process.exit(0) }',
  'appendFileSync(process.env.SELECTOR_RUNS, JSON.stringify(process.argv.slice(2)) + "\\n")',
  'const pattern = process.argv.find(arg => arg.startsWith("-test.run="))?.slice("-test.run=".length)',
  'for (const name of names) if (!pattern || new RegExp(pattern).test(name)) {',
  '  console.log("EXEC " + name)',
  '  if (name === process.env.SELECTOR_FAIL_TEST) process.exitCode = 1',
  '}'
].join("\n")
const paste = [
  "#!/bin/sh",
  'case "$SELECTOR_FAULT" in',
  '  healthy) exec "$SELECTOR_PASTE" "$@" ;;',
  "  partial) echo TestA ;;",
  "  wrong) echo TestMissing ;;",
  "esac",
  'echo "fixture selector tool failed" >&2',
  'exit "$SELECTOR_CODE"'
].join("\n")

function run(t, { names = ["TestA", "TestB", "TestC"], shards = 3, fault = "healthy", code = 0, failing = "" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "go shard selector-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const dir of ["bin", "tmp"]) mkdirSync(join(root, dir))
  const binary = join(root, "peer.mjs"), runs = join(root, "runs.jsonl")
  writeFileSync(binary, peer, { mode: 0o700 })
  writeFileSync(join(root, "bin/paste"), paste, { mode: 0o700 })
  const result = spawnSync("sh", [script, binary, "-test.v", "-test.short=true"], {
    cwd: root, encoding: "utf8", timeout: 15_000,
    env: {
      ...process.env, PATH: join(root, "bin") + delimiter + process.env.PATH,
      TMPDIR: join(root, "tmp"), GO_TEST_SLICE: "1/1", GO_TEST_SHARDS: String(shards),
      SELECTOR_NAMES: JSON.stringify(names), SELECTOR_RUNS: runs,
      SELECTOR_FAULT: fault, SELECTOR_CODE: String(code), SELECTOR_PASTE: realPaste,
      SELECTOR_FAIL_TEST: failing
    }
  })
  assert.equal(result.error, undefined, result.stderr)
  assert.equal(result.status, failing ? 1 : 0, result.stdout + result.stderr)
  assert.deepEqual(result.stdout.split("\n").filter(line => line.startsWith("EXEC ")).sort(),
    names.map(name => "EXEC " + name).sort(), "every listed test executes exactly once")
  const argumentsByRun = readFileSync(runs, "utf8").trim().split("\n").map(line => JSON.parse(line))
  assert.equal(argumentsByRun.length, Math.min(names.length, shards))
  for (const args of argumentsByRun) assert.deepEqual(args.slice(0, 2), ["-test.v", "-test.short=true"])
  assert.deepEqual(readdirSync(join(root, "tmp")), [], "temporary files are removed")
  return result
}

for (const failing of ["", "TestB"]) test("healthy selector control preserves suite status: " + (failing || "success"), t => {
  run(t, { failing })
})
for (const fault of ["empty", "partial", "wrong"]) for (const code of [1, 7, 137]) {
  for (const failing of ["", "TestB"]) test("selectors survive an unavailable join tool: " + JSON.stringify({ fault, code, failing }), t => {
    run(t, { fault, code, failing })
  })
}
// Generated neighbouring suite shapes exercise single/multiple names per shard,
// Test/Fuzz/Example prefixes and underscores without starting a Go build per case.
test("generated suite shapes remain complete without an external selector join", t => {
  for (let seed = 1; seed <= 32; seed++) {
    const names = Array.from({ length: 1 + seed % 11 }, (_, i) =>
      ["Test", "Fuzz", "Example"][(seed + i) % 3] + "Case_" + seed + "_" + i)
    run(t, { names, shards: 2 + seed % 5, fault: ["empty", "partial", "wrong"][seed % 3], code: 1 + seed % 137 })
  }
})
