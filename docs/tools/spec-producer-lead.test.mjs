import assert from "node:assert/strict"
import { test } from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

const witness = () => block(chapter("008-runtime"), "// Concurrent producer witness: VIP-19, VIP-21, VIP-31")

test("one buffered value permits each concurrent emitter to start before the consumer continues", () => {
  const result = run(witness())
  assert.equal(result.status, 0, result.stderr)
})

test("enforcing a global sequential emitter would change the Exit", () => {
  const source = witness()
  const sequential = source.replace('concurrency: "unbounded"', "concurrency: 1")
  assert.notEqual(sequential, source)
  const result = run(sequential)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /concurrent producer stalled/)
})

test("every stated two-element bound is qualified for concurrent emitters", () => {
  for (const path of ["docs/design/src/002-running.md", "docs/design/vips/0021-producers.md", "docs/user/src/stream/053-introduction.md", "docs/user/src/vibelang-features/112-producers.md"]) {
    assert.ok(read(path).includes("one sequential emitter"), path + " omits the sequential-emitter qualification")
    assert.ok(/pending offer|pending emitter/.test(read(path)), path + " omits concurrent pending offers")
  }
})
