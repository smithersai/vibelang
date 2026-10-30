import assert from "node:assert/strict"
import test from "node:test"
import { runChild } from "./child.mjs"

test("a child that never exits is killed at its limit and named", async () => {
  const started = Date.now()
  await assert.rejects(runChild(process.execPath, ["-e", "console.log('ready'); setInterval(() => {}, 1000)"], { limit: 1000 }),
    (error) => /did not exit within 1 s/.test(error.message) && /Still running:/.test(error.message) && /ready/.test(error.message))
  assert.ok(Date.now() - started < 10_000)
})

test("a child that exits while its own child holds the output resolves, and that child is killed", async () => {
  const script = `
const { spawn } = require("node:child_process")
const holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" })
console.log("holder " + holder.pid)
process.exit(3)
`
  const started = Date.now()
  const result = await runChild(process.execPath, ["-e", script], { limit: 30_000 })
  assert.equal(result.code, 3)
  assert.ok(Date.now() - started < 20_000)
  const holder = Number(/holder (\d+)/.exec(result.stdout)[1])
  await new Promise((accept) => setTimeout(accept, 200))
  assert.throws(() => process.kill(holder, 0), { code: "ESRCH" })
})

test("a child that exits normally resolves with its code and output", async () => {
  const result = await runChild(process.execPath, ["-e", "console.log('out'); console.error('err'); process.exit(2)"])
  assert.deepEqual([result.code, result.stdout, result.stderr], [2, "out\n", "err\n"])
})

test("a test file that leaves a handle open still exits, and the handle is named", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const dir = await mkdtemp(join(tmpdir(), "vite-leak-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, "leak.test.mjs")
  await writeFile(file, `import { test } from "node:test"\ntest("leaves a timer", () => { setInterval(() => {}, 1000) })\n`)
  const report = new URL("./report-handles.mjs", import.meta.url).href
  // run.sh's flags. A child of a test file that inherits NODE_TEST_CONTEXT
  // refuses to run test files, so the child runs as run.sh's node does.
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = await runChild(process.execPath, ["--test", "--test-force-exit", "--import", report, file], { limit: 60_000, env })
  assert.equal(result.code, 0)
  assert.match(result.output, /leak\.test\.mjs left handles open after its tests: Timeout/)
})

test("the handle report ignores standard streams and handles whose close callbacks just ran", async (t) => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const dir = await mkdtemp(join(tmpdir(), "vite-closed-handles-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, "closed.test.mjs")
  await writeFile(file, `
import { test } from "node:test"
import { spawn } from "node:child_process"
test("uses stdin and closes a child", async () => {
  void process.stdin
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", ""])
    child.on("error", reject)
    child.on("close", resolve)
  })
})
`)
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const report = new URL("./report-handles.mjs", import.meta.url).href
  const result = await runChild(process.execPath, ["--test", "--test-force-exit", "--import", report, file], { env })
  assert.equal(result.code, 0, result.output)
  assert.doesNotMatch(result.output, /left handles open/, result.output)
})
