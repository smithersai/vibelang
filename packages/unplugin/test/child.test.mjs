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
