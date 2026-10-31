import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"
const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")

test("the outside-effect placement rule explicitly names the three interruption forms", () => {
  const text = running().slice(running().indexOf("## Interruption blocks"))
  const row = text.split("\n").find(line => line.startsWith("|") && line.includes("outside effect code") && line.endsWith("EK2201` |"))
  assert.ok(row, "the EK2201 outside-effect rule exists")
  for (const name of ["uninterruptible", "interruptible", "restore"]) {
    assert.ok(row.includes("`" + name + " { }`"), name)
  }
  assert.doesNotMatch(row, /any of the three/)
  assert.match(row, /not .*EK2111/)
})
