import assert from "node:assert/strict"
import { Effect, Fiber, Tracer } from "effect"
import * as programs from "./out/main.js"
import { latch, write, publish } from "./out/probe.js"

// Effect 4.1.0 tracer context runs immediately before each primitive. This
// latch delivers interruption at the first primitive after write has returned,
// including the erroneous Iterator continuation, without timers or scheduling.
const tracer = Tracer.make({
  span: (options) => new Tracer.NativeSpan(options),
  context: (primitive, fiber) => {
    if (latch.depth !== undefined && fiber._stack.length < latch.depth - 1) {
      latch.depth = undefined
      latch.interrupted = true
      fiber.interruptUnsafe()
    }
    return primitive["~effect/Effect/evaluate"](fiber)
  }
})
async function run(program) {
  Object.assign(latch, { depth: undefined, published: false, interrupted: false })
  const exit = await Effect.runPromise(Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(program.pipe(Effect.provideService(Tracer.Tracer, tracer)))
    return yield* Fiber.await(fiber)
  }))
  return { exit: exit._tag, interrupted: latch.interrupted, published: latch.published }
}
const expected = { exit: "Failure", interrupted: true, published: true }
const ts = await run(Effect.uninterruptibleMask((restore) => restore(write()).pipe(Effect.flatMap(publish))))
assert.deepEqual(ts, expected, "typescript reference")
const results = {}
for (const name of ["commitThenPublish", "withOperand", "withTopic", "withValue", "withOptional", "withTag", "withThis", "withMethod"]) {
  const result = await run(programs[name].call({ write }))
  assert.deepEqual(result, expected, name)
  results[name] = result.published
}
assert.deepEqual(await Effect.runPromise(programs.lazyTwice()), [1, 2], "D147 reevaluates on each run")
console.log(JSON.stringify({ typescript: ts.published, ...results, lazy: true }))
