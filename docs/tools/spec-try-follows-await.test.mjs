import "./pinned-dependency-controls.mjs"
import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"

test("every place try differs from await is in the table, with a reason", () => {
  const running = chapter("002-running")
  assert.equal([...running.matchAll(/id="try-follows-await"/g)].length, 1)
  for (const reason of ["008-runtime.md#abandonment", "VIP-26", "VIP-2", "`catch` sees failures only", "cold"]) {
    assert.ok(running.includes(reason), reason)
  }
})
