import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Effect, Exit, Pull, Queue, Stream } from "effect"
import { main, producer } from "./out/main.js"
const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const fc = require("fast-check")
function native(count) {
  const events = []
  const stream = Stream.callback(queue => Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.sync(() => { events.push("closed") }))
    for (let i = 0; i < count; i++) yield* Queue.offer(queue, i)
    yield* Queue.end(queue)
  }), { bufferSize: 1, strategy: "suspend" })
  return Effect.as(Effect.scoped(Effect.gen(function* () {
    const pull = yield* Stream.toPull(stream)
    let consumed = 0
    while (true) {
      const result = yield* Effect.exit(pull)
      if (Exit.isFailure(result)) {
        if (Pull.isDoneCause(result.cause)) return
        return yield* Effect.failCause(result.cause)
      }
      for (const item of result.value) {
        yield* Effect.ensuring(Effect.gen(function* () {
          events.push("body")
          yield* Effect.yieldNow
        }), Effect.sync(() => { events.push("dispose") }))
        if (++consumed === 2) return
      }
    }
  })), events)
}
await fc.assert(fc.asyncProperty(fc.boolean(), fc.integer({ min: 0, max: 8 }), async (reverse, count) => {
  assert.deepEqual(await Effect.runPromise(producer(reverse, count)),
    await Effect.runPromise(native(count)), "both label aliases retain native close order")
}), { seed: 21305, numRuns: 40 })
console.log("@@result " + JSON.stringify(await Effect.runPromise(main())))
