import { test } from "node:test"
import assert from "node:assert/strict"

const output = t => {
  t.diagnostic("ENOSPC SIGKILL ECONNRESET timed out after 5ms")
  console.log("ENOSPC SIGKILL")
  console.error("ECONNRESET timed out after 5ms")
}
test("ordinary failure", t => {
  if (process.env.CI_HEALTH_OUTPUT_OWNER === "actual") output(t)
  assert.equal(process.env.CI_HEALTH_WITNESS_STATE,"pass")
})
test("expected resource control", {todo:""}, t => {
  if (process.env.CI_HEALTH_OUTPUT_OWNER === "expected") output(t)
  throw Error("expected control")
})
