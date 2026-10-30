import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect, Exit } from "effect"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("for concurrent specifies native pulling, failure closing and array reuse together", () => {
  const section = chapter("002-running").split("## `for concurrent`")[1]?.split("## `for try`")[0] ?? ""
  assert.match(section, /pulls incrementally/)
  assert.match(section, /does not call.*return.*item.*fail/)
  assert.match(section, /materializes a non-array iterable/)
  assert.match(section, /array.*reused by reference/)
  assert.match(section, /endless non-array iterable/)
})

test("the public VIP and concurrency guide state that limits do not bound pulling", () => {
  for (const path of ["docs/design/vips/0019-for-concurrent.md", "docs/user/src/concurrency/007-basic-concurrency.md"]) {
    const text = read(path)
    assert.match(text, /pulling/, path)
    assert.match(text, /custom iterator/, path)
  }
})

test("the runtime iterable lifecycle witness agrees with pinned Effect", () => {
  const result = run(block(chapter("008-runtime"), "Iterable lifecycle witness"))
  assert.equal(result.status, 0, result.stderr + result.stdout)
})

test("native iteration errors keep their defect and branch timing without extra closing", () => {
  for (const concurrency of [1, 2, "unbounded"]) {
    const marker = new Error("next")
    const trace = []
    let index = 0
    const iterable = {
      [Symbol.iterator]() {
        trace.push("iterator")
        return {
          next() {
            trace.push("next")
            if (index++ === 0) return { done: false, value: 0 }
            throw marker
          },
          return() { trace.push("return"); return { done: true } }
        }
      }
    }
    const result = Effect.runSyncExit(Effect.forEach(iterable,
      () => Effect.sync(() => { trace.push("item") }), { concurrency, discard: true }))
    assert.ok(Exit.isFailure(result))
    assert.equal(result.cause.reasons[0]._tag, "Die")
    assert.equal(result.cause.reasons[0].defect, marker)
    assert.deepEqual(trace, concurrency === 1 ? ["iterator", "next", "item", "next"] : ["iterator", "next", "next"])
  }
})

test("parallel traversal reads later elements from the reused array", () => {
  const items = [1, 2]
  const seen = []
  Effect.runSync(Effect.forEach(items, item => Effect.sync(() => {
    seen.push(item)
    if (item === 1) items[1] = 9
  }), { concurrency: 2, discard: true }))
  assert.deepEqual(seen, [1, 9])
})
