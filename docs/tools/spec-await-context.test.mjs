import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { Effect } from "effect"
import { chapter } from "./spec-witness.mjs"
const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")

test("the parity table assigns each operator its corresponding function context", () => {
  const row = running().split("\n").find(line => line.startsWith("|") && line.includes("the corresponding function"))
  assert.ok(row, "do not say both operators are allowed in either function body")
  assert.ok(row.includes("async") && row.includes("for") && row.includes("await"))
  assert.ok(row.includes("effect") && row.includes("try"))
  assert.match(row, /inside that context/)
})

test("the native counterparts use async await and generator Effect execution", async () => {
  assert.equal(await (async () => await 1)(), 1)
  assert.equal(Effect.runSync(Effect.gen(function* () { return yield* Effect.succeed(1) })), 1)
})
