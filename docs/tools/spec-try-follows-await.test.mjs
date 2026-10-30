import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect, Exit } from "effect"
import { chapter } from "./spec-witness.mjs"

const closing = (log) => ({
  [Symbol.iterator]() { return this },
  next() { return { done: false, value: 1 } },
  return() { log.push("close"); return {} },
})

test("a rejected await resumes with a throw, so cleanup runs", async () => {
  const log = []
  const body = async () => {
    using _ = { [Symbol.dispose]() { log.push("dispose") } }
    try { for (const _ of closing(log)) await Promise.reject("r") } finally { log.push("finally") }
  }
  await assert.rejects(body(), (e) => e === "r")
  assert.deepEqual(log, ["close", "finally", "dispose"])
})

test("a failed try never resumes the generator, so no cleanup runs", () => {
  for (const failure of [Effect.fail("f"), Effect.die("d")]) {
    const log = []
    const body = Effect.gen(function* () {
      using _ = { [Symbol.dispose]() { log.push("dispose") } }
      try { for (const _ of closing(log)) yield* failure } finally { log.push("finally") }
    })
    assert.ok(Exit.isFailure(Effect.runSyncExit(body)))
    assert.deepEqual(log, [])
  }
})

test("a JavaScript throw in the generator does unwind it", () => {
  const log = []
  const body = Effect.gen(function* () {
    for (const _ of closing(log)) throw "t"
  })
  assert.ok(Exit.isFailure(Effect.runSyncExit(body)))
  assert.deepEqual(log, ["close"])
})

test("every place try differs from await is in the table, with a reason", () => {
  const running = chapter("002-running")
  assert.equal([...running.matchAll(/id="try-follows-await"/g)].length, 1)
  for (const reason of ["008-runtime.md#abandonment", "VIP-26", "VIP-2", "`catch` sees failures only", "cold"]) {
    assert.ok(running.includes(reason), reason)
  }
})
