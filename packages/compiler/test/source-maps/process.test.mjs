import { strict as assert } from "node:assert"
import { test } from "node:test"
import { run } from "./helpers.mjs"

test("child diagnostics distinguish a deadline from a normal exit", async () => {
  const timedOut = await run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeout: 100 })
  assert.equal(timedOut.timedOut, true)
  assert.equal(timedOut.code, null)
  assert.equal(timedOut.signal, "SIGKILL")
  assert.ok(Number.isFinite(timedOut.elapsedMs))

  const completed = await run(process.execPath, ["-e", 'console.log("ready")'], { timeout: 5000 })
  assert.equal(completed.timedOut, false)
  assert.equal(completed.code, 0)
  assert.equal(completed.stdout, "ready\n")
})
