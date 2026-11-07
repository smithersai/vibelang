import assert from "node:assert/strict"
import { Effect, Exit } from "effect"
import * as fixtures from "./out/fixtures.js"
import { inGenerator, plainDefault, effectDefault, asyncDefault } from "./out/main.js"
import * as main from "./out/main.js"

const dies = (exit) => {
  assert.ok(Exit.isFailure(exit), "expected a failed Exit")
  const reasons = exit.cause.reasons
  assert.equal(reasons.length, 1)
  assert.equal(reasons[0]._tag, "Die")
  return reasons[0].defect
}

// Inside an Effect generator the throw is a defect, not a typed failure and
// not a JavaScript exception from the call.
const generator = inGenerator()
assert.equal(fixtures.calls, 0, "inGenerator() must not run the body at the call")
const generatorDefect = dies(Effect.runSyncExit(generator))
assert.equal(generatorDefect.message, "early")
assert.equal(main.bodies, 1)
console.log("generator: Die early")

// A plain function's default throws a JavaScript exception at the call.
assert.throws(() => plainDefault(), { message: "early" })
assert.equal(main.bodies, 1, "the plain body must not run")
assert.equal(plainDefault(Effect.succeed(1)), "plain body")
console.log("plain default: throws early")

// An effect function's default: the call returns an Effect that dies.
// The default runs at the call, before the Effect exists.
const callsBefore = fixtures.calls
let effect
assert.doesNotThrow(() => { effect = effectDefault() })
assert.equal(fixtures.calls, callsBefore + 1, "the default runs at the call")
assert.ok(Effect.isEffect(effect))
const defaultDefect = dies(Effect.runSyncExit(effect))
assert.equal(defaultDefect.message, "early")
assert.equal(fixtures.calls, callsBefore + 1, "running the Effect does not rerun the default")
assert.equal(main.bodies, 2, "the effect body must not run")
assert.equal(Effect.runSync(effectDefault(Effect.succeed(1))), "effect body")
console.log("effect default: returns an Effect that dies with early")

// As an async function's call returns a rejected Promise.
const promise = asyncDefault()
assert.ok(promise instanceof Promise)
await assert.rejects(promise, { message: "early" })
console.log("async default: rejects with early")
