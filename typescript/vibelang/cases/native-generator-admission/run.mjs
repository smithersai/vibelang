import assert from "node:assert/strict"
import { Cause, Effect, Exit, Stream } from "effect"
import * as actual from "./out/main.js"
import * as twin from "./out/twin.js"
const steps = (iterator) => [iterator.next(), iterator.next(), iterator.next()]
assert.deepEqual(steps(actual.values()), steps(twin.values()))
assert.deepEqual([...actual.values()], [...twin.values()])
assert.deepEqual(actual.nativeNumbers(), twin.nativeNumbers())
assert.equal(await Effect.runPromise(actual.program()), await Effect.runPromise(twin.program()))
assert.deepEqual(await Effect.runPromise(Stream.runCollect(actual.streamValues())), await Effect.runPromise(Stream.runCollect(twin.streamValues())))
for (const mod of [actual, twin]) {
  const exit = await Effect.runPromiseExit(mod.invalid())
  assert.ok(Exit.isFailure(exit))
  assert.ok(exit.cause.reasons.some(Cause.isDieReason))
}
console.log("native generators and Effect.gen retain JavaScript semantics")
