import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { Effect, Exit, Pull, Queue, Stream } from "effect"
import { main, producer } from "./out/main.js"
const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const fc = require("fast-check")
function native(fail, count) {
  const events = []
  const stream = Stream.callback(queue => Effect.gen(function* () {
    yield* Effect.addFinalizer(() => Effect.sync(() => { events.push("producer done") }))
    for (let i = 1; i <= count; i++) yield* Queue.offer(queue, "p" + i)
    yield* Queue.end(queue)
  }), { bufferSize: 1, strategy: "suspend" })
  return Effect.map(Effect.exit(Stream.runForEach(stream, item => Effect.gen(function* () {
      using value = { [Symbol.dispose]() { events.push("dispose " + item) } }
      events.push("body")
      yield* Effect.sleep("1 millis")
      if (fail) return yield* Effect.fail("failed")
    }))),
    outcome => [Exit.isFailure(outcome), events])
}
await fc.assert(fc.asyncProperty(fc.boolean(), fc.integer({ min: 0, max: 8 }), async (fail, count) => {
  assert.deepEqual(await Effect.runPromise(producer(fail, count)),
    await Effect.runPromise(native(fail, count)), "native callback scope disposal")
}), { seed: 21095, numRuns: 40 })
console.log("@@result " + JSON.stringify(await Effect.runPromise(main())))
