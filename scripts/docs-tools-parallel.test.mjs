import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

const declaration = readFileSync(new URL("../PACKAGE.ts", import.meta.url), "utf8")
const match = /"docs-tools": check\(\s*"[^"]*",\s*("(?:\\.|[^"\\])*")/.exec(declaration)
assert.ok(match, "docs-tools must declare its test command")
const command = JSON.parse(match[1])

// Execute the actual target command on real Bun files. Synchronous barriers
// distinguish file workers from serial execution or concurrency within one file.
function fixture(t, failing = false) {
  const root = mkdtempSync(join(tmpdir(), "docs-tools-workers-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const tools = join(root, "docs/tools")
  mkdirSync(tools, { recursive: true })
  writeFileSync(join(tools, "registry.ts"), "export const registry = { files: 0 }\n")
  for (let i = 0; i < 4; i++) {
    writeFileSync(join(tools, `worker-${i}.test.ts`), `
import { test, expect } from "bun:test"
import { writeFileSync, readdirSync } from "node:fs"
import { registry } from "./registry"
let step = 0
test("worker ${i} starts alongside other files", () => {
  writeFileSync("started-${i}", String(process.pid))
  const deadline = Date.now() + 4000
  while (readdirSync(".").filter(p => p.startsWith("started-")).length < 3 && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
  }
  expect(readdirSync(".").filter(p => p.startsWith("started-")).length).toBeGreaterThanOrEqual(3)
  expect(step++).toBe(0)
  writeFileSync("registry-${i}", String(++registry.files))
})
test("worker ${i} retains per-file ordering", () => {
  expect(step++).toBe(1)
  writeFileSync("finished-${i}", "done")
})
`)
  }
  for (const name of ["site-contrast.test.ts", "site-spec-links.test.ts"]) {
    writeFileSync(join(tools, name), 'throw new Error("excluded site target ran")\n')
  }
  if (failing) writeFileSync(join(tools, "failure.test.ts"),
    'import { test, expect } from "bun:test"; test("failure must reach the graph", () => { expect("witness").toBe("fixed") })\n')
  return { root, tools }
}

function run(root) {
  return spawnSync("sh", ["-c", command], { cwd: root, encoding: "utf8", timeout: 20000 })
}

test("docs-tools runs all discovered files on three workers and keeps site targets separate", t => {
  const { root, tools } = fixture(t)
  const result = run(root)
  assert.equal(result.status, 0, result.error?.message ?? result.stdout + result.stderr)
  const started = readdirSync(tools).filter(p => p.startsWith("started-"))
  assert.equal(started.length, 4, "a newly discovered file was omitted")
  const pids = new Set(started.map(p => readFileSync(join(tools, p), "utf8")))
  assert.equal(pids.size, 3, "the target must bound its file workers to three")
  const counters = readdirSync(tools).filter(p => /^registry-/.test(p))
    .map(p => Number(readFileSync(join(tools, p), "utf8"))).sort()
  assert.deepEqual(counters, [1, 1, 1, 2], "workers must retain the serial runner's module reuse between files")
  assert.equal(readdirSync(tools).filter(p => p.startsWith("finished-")).length, 4)
})

test("a worker failure fails the docs-tools target without dropping the other files", t => {
  const { root, tools } = fixture(t, true)
  const result = run(root)
  assert.equal(result.signal, null, result.error?.message)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /failure must reach the graph/)
  assert.equal(readdirSync(tools).filter(p => p.startsWith("finished-")).length, 4)
})
