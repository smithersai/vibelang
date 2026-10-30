import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")

test("a normal region keeps its source value while its layer observes generator fallthrough", () => {
  const source = block(running(), "const providedCompletion =")
    .replace('import { Effect, Layer } from "effect"', 'import { Effect, Layer } from "effect"\nconst observed: unknown[] = []\nconst observer = Layer.effectDiscard(Effect.addFinalizer(exit => Effect.sync(() => { observed.push(exit) })))')
    .replaceAll("Layer.empty", "observer")
  const result = run(source + `
import assert from "node:assert/strict"
assert.equal(Effect.runSync(providedCompletion), 7)
assert.equal(observed.length, 1)
assert.equal(observed[0]._tag, "Success")
assert.equal(observed[0].value, undefined)
`)
  assert.equal(result.status, 0, result.stderr)
})

test("observer witnesses preserve payload identity, nesting, reruns and unsuccessful cleanup", () => {
  const result = run(block(running(), "function observedNormal(") + `
import assert from "node:assert/strict"
const seen: unknown[] = []
const cold = observedNormal(seen)
assert.equal(Effect.runSync(cold), 7)
assert.equal(Effect.runSync(cold), 7)
assert.equal(Effect.runSync(observedReturn(seen, 7)), 7)
assert.equal(Effect.runSync(observedBreak(seen)), 7)
const data = { _tag: "Return", value: 9 }
assert.equal(Effect.runSync(observedReturn(seen, data)), data)
const effectData = Effect.succeed(3)
assert.equal(Effect.runSync(observedReturn(seen, effectData)), effectData)
assert.deepEqual(seen, [undefined, undefined, 7, undefined, data, effectData])
const nested: unknown[] = []
assert.equal(Effect.runSync(observedNested(nested, false)), 7)
assert.deepEqual(nested, [["inner", undefined], ["outer", undefined]])
nested.length = 0
assert.equal(Effect.runSync(observedNested(nested, true)), 7)
assert.deepEqual(nested, [["inner", 7], ["outer", 7]])

const continued: unknown[] = []
const continuedResult = Effect.runSync(Effect.gen(function* () {
  outer: for (const n of [0, 1]) {
    let skip = false
    yield* Effect.provide(Effect.gen(function* () { skip = true }), observingLayer(continued))
    if (skip) continue outer
    throw new Error("unreachable")
  }
  return 7
}))
assert.equal(continuedResult, 7)
assert.deepEqual(continued, [undefined, undefined])
const bare: unknown[] = []
assert.equal(Effect.runSync(observedReturn(bare, undefined)), undefined)
assert.deepEqual(bare, [undefined])
for (const [body, tag, payload] of [
  [Effect.fail("no"), "Fail", "no"],
  [Effect.die("bad"), "Die", "bad"],
  [Effect.interrupt, "Interrupt", undefined]
]) {
  const exits: unknown[] = []
  const exit = Effect.runSyncExit(Effect.gen(function* () {
    yield* Effect.provide(body, observingLayer(exits))
    return 7
  }))
  assert.equal(exit._tag, "Failure")
  assert.equal(exits.length, 1)
  assert.equal(exits[0]._tag, "Failure")
  assert.equal(exit.cause.reasons[0]._tag, tag)
  if (tag === "Fail") assert.equal(exits[0].cause.reasons[0].error, payload)
  if (tag === "Die") assert.equal(exits[0].cause.reasons[0].defect, payload)
}
const failed = Effect.runSyncExit(observerCleanupFailure)
assert.deepEqual(failed.cause.reasons.map(r => [r._tag, r.defect]), [["Die", "cleanup"]])
`)
  assert.equal(result.status, 0, result.stderr)
})


test("the runtime-guarantee pair distinguishes normal completion from source return", () => {
  const text = process.env.SPEC_RUNTIME ? readFileSync(process.env.SPEC_RUNTIME, "utf8") : chapter("008-runtime")
  const result = run(block(text, "function normalObservation(") + `
import assert from "node:assert/strict"
assert.equal(Effect.runSync(normalObservation()), 7)
assert.equal(Effect.runSync(returnObservation()), 7)
assert.deepEqual(released.map(exit => [exit._tag, exit.value]), [["Success", undefined], ["Success", 7]])
`)
  assert.equal(result.status, 0, result.stderr)
})

test("the existing jump witnesses retain their results without returning control records", () => {
  const text = running()
  const result = run(`
import { Context, Effect, Layer } from "effect"
class Users extends Context.Service<Users, { has(id: string): Effect.Effect<boolean> }>()("region-observers/Users") {}
const testUsers = { has: (id: string) => Effect.succeed(id === "found") }
` + block(text, "function find(ids: string[])") + block(text, "function f(xs: number[])") + `
import assert from "node:assert/strict"
assert.equal(Effect.runSync(find(["skip", "miss", "found"])), "found")
assert.equal(Effect.runSync(find(["stop", "found"])), "none")
assert.equal(Effect.runSync(f([1, 2])), 12)
`)
  assert.equal(result.status, 0, result.stderr)
})
