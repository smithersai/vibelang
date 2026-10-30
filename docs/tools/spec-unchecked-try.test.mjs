import assert from "node:assert/strict"
import { test } from "node:test"
import { Effect, Exit } from "effect"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("unchecked try documents native delegation rather than await identity or a dynamic guard", () => {
  const text = chapter("002-running")
  const row = text.split("\n").find(line => line.startsWith("|") && line.includes("noniterable"))
  assert.ok(row, "the await comparison omits unchecked noniterable operands")
  assert.match(row, /TypeError/)
  assert.match(text, /no runtime Effect guard/)
  assert.match(text, /empty iterable/)
})

test("the accepted VIP states the unchecked delegation rule", () => {
  assert.match(read("docs/design/vips/0005-try-runs-effects.md"), /native delegation/)
})

test("the runtime chapter's unchecked operands keep their reference Exits", () => {
  const result = run(block(chapter("008-runtime"), "Unchecked delegation witness"))
  assert.equal(result.status, 0, result.stderr + result.stdout)
})

test("native iterator failures retain error identity, message and reached protocol order", () => {
  const marker = new Error("protocol")
  const cases = [
    () => 5,
    () => undefined,
    () => Promise.resolve(5),
    () => ({ get [Symbol.iterator]() { throw marker } }),
    () => ({ [Symbol.iterator]: 1 }),
    () => ({ [Symbol.iterator]() { return 1 } }),
    () => ({ [Symbol.iterator]() { return { next: 1 } } }),
    () => ({ [Symbol.iterator]() { return { next() { return 1 } } } }),
    () => ({ [Symbol.iterator]() { return { next() { return { get done() { throw marker } } } } } }),
    () => ({ [Symbol.iterator]() { return { next() { return { done: true, get value() { throw marker } } } } } })
  ]
  for (const make of cases) {
    let reference
    try { (function* () { return yield* make() })().next() } catch (error) { reference = error }
    assert.ok(reference, "native control must throw")
    const result = Effect.runSyncExit(Effect.gen(function* () { return yield* make() }))
    assert.ok(Exit.isFailure(result))
    assert.equal(result.cause.reasons.length, 1)
    const reason = result.cause.reasons[0]
    assert.equal(reason._tag, "Die")
    assert.equal(reason.defect.name, reference.name)
    assert.equal(reason.defect.message, reference.message)
    if (reference === marker) assert.equal(reason.defect, marker)
  }
  const trace = []
  const iterable = {
    get [Symbol.iterator]() {
      trace.push("iterator:get")
      return function () {
        assert.equal(this, iterable)
        trace.push("iterator:call")
        return {
          get next() {
            trace.push("next:get")
            return function () {
              trace.push("next:call")
              return {
                get done() { trace.push("done"); return true },
                get value() { trace.push("value"); return 9 }
              }
            }
          }
        }
      }
    }
  }
  const program = Effect.gen(function* () { trace.push("operand"); return yield* iterable })
  assert.deepEqual(trace, [])
  const result = Effect.runSyncExit(program)
  assert.ok(Exit.isSuccess(result))
  assert.equal(result.value, 9)
  assert.deepEqual(trace, ["operand", "iterator:get", "iterator:call", "next:get", "next:call", "done", "value"])
})

test("Effect drives only next and does not synthesize iterator throw or return on abandonment", () => {
  for (const operand of [Effect.fail("bad"), Effect.die("boom"), Effect.interrupt]) {
    const trace = []
    const iterable = {
      [Symbol.iterator]() {
        return {
          next() { trace.push("next"); return { done: false, value: operand } },
          get throw() { trace.push("throw"); throw new Error("must not be read") },
          get return() { trace.push("return"); throw new Error("must not be read") }
        }
      }
    }
    const result = Effect.runSyncExit(Effect.gen(function* () {
      yield* iterable
      trace.push("after")
    }))
    assert.ok(Exit.isFailure(result))
    assert.deepEqual(trace, ["next"])
  }
})
