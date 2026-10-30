import assert from "node:assert/strict"
import { test } from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

const witness = () => block(chapter("008-runtime"), "// Coldness witness: VIP-1, VIP-2, VIP-31")

test("call-time defaults run once and a cold body runs on each execution", () => {
  const result = run(witness())
  assert.equal(result.status, 0, result.stderr)
})

test("the trace check rejects an eager body with the same success value", () => {
  const source = witness()
  const eager = source.replace('return Effect.gen(function* () { trace.push("body"); return value })', 'trace.push("body"); return Effect.succeed(value)')
  assert.notEqual(eager, source)
  const result = run(eager)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /body ran during construction/)
})

test("the trace check rejects a default incorrectly moved into the cold body", () => {
  const source = witness()
  const deferred = source.replace("function program(value = parameter())", "function program(value?: number)")
    .replace('trace.push("body"); return value', 'value ??= parameter(); trace.push("body"); return value')
  assert.notEqual(deferred, source)
  const result = run(deferred)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /call-time default changed/)
})
