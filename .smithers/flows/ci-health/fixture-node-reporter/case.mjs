// Controlled executions of the real compiler-shard reporter, including cancellation.
import assert from "node:assert/strict"
import { test } from "node:test"

const failing = process.env.CI_HEALTH_WITNESS_STATE === "fail"
test("structured compiler check", () => assert.equal(failing, false))
test("nested group", async t => {
  await t.test('quoted "child" / Unicode ☃', () => assert.equal(failing, false))
})
test("bounded unfinished check", { timeout: 25 }, () => failing ? new Promise(() => {}) : undefined)
test("skipped control", { skip: "intentional skip" }, () => { throw new Error("SKIP_CONTROL") })
test("todo control", { todo: "intentional todo" }, () => { throw new Error("TODO_CONTROL") })
test("empty todo reason", { todo: "" }, () => { throw new Error("EMPTY_TODO_CONTROL") })
test("empty skip reason", { skip: "" }, () => { throw new Error("EMPTY_SKIP_CONTROL") })
test("Unicode \u2028 and \u2029 separators", () => assert.equal(failing, false))
