#!/usr/bin/env node
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { runSuite } from "../lib/harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const runtimeReq = createRequire(path.join(root, "packages/runtime/package.json"))
const { Data, Effect, Stream } = runtimeReq("effect")
const rt = await import(path.join(root, "packages/runtime/dist/index.js"))
const { $fork, $join, $forConcurrent, $catch, $catchExpression, $produce, $yield, $tryAll, $tryRace } = rt

class Boom extends Data.TaggedError("Boom") {}

const items32 = Array.from({ length: 32 }, (_, i) => i + 1)
const sum32 = (32 * 33) / 2

const forkJoinEffect = Effect.scoped(Effect.gen(function* () {
  const f1 = yield* $fork(Effect.succeed(10))
  const f2 = yield* $fork(Effect.succeed(32))
  return (yield* $join(f1)) + (yield* $join(f2))
}))

const tryAllEffect = $tryAll([Effect.succeed(1), Effect.succeed(2), Effect.succeed(3), Effect.succeed(4)])
const tryRaceEffect = $tryRace([Effect.succeed(7), Effect.succeed(9)])

const forConcurrentUnbounded = Effect.gen(function* () {
  let sum = 0
  yield* $forConcurrent(items32, "unbounded", (x) => Effect.sync(() => { sum += x }))
  return sum
})

const forConcurrentBounded4 = Effect.gen(function* () {
  let sum = 0
  yield* $forConcurrent(items32, 4, (x) => Effect.sync(() => { sum += x }))
  return sum
})

const catchSuccessEffect = $catch(Effect.succeed(42), () => Effect.succeed(0))
const catchFailEffect = $catch(Effect.fail(new Boom()), () => Effect.succeed(99))
const catchExprSuccess = $catchExpression(() => Effect.succeed(42), () => Effect.succeed(0))

const producerStream = $produce(Effect.fnUntraced(function* () {
  for (let i = 1; i <= 32; i++) {
    yield* $yield(i)
  }
}))
const consumeProducer = Stream.runFold(producerStream, () => 0, (acc, n) => acc + n)

await runSuite({
  suite: "runtime-concurrency",
  category: "runtime",
  description: "Runtime fibers, concurrency ($fork/$join, $forConcurrent, $tryAll, $tryRace), $catch, and $produce streams.",
  cases: [
    {
      name: "$fork + $join (2 fibers)",
      async: true,
      fn: () => Effect.runPromise(forkJoinEffect),
      verify: (v) => assert.equal(v, 42)
    },
    {
      name: "$tryAll (4 effects)",
      async: true,
      fn: () => Effect.runPromise(tryAllEffect),
      verify: (v) => assert.deepEqual(v, [1, 2, 3, 4])
    },
    {
      name: "$tryRace (2 effects)",
      async: true,
      fn: () => Effect.runPromise(tryRaceEffect),
      verify: (v) => assert.ok(v === 7 || v === 9)
    },
    {
      name: "$forConcurrent (32 items, unbounded)",
      async: true,
      fn: () => Effect.runPromise(forConcurrentUnbounded),
      verify: (v) => assert.equal(v, sum32)
    },
    {
      name: "$forConcurrent (32 items, limit 4)",
      async: true,
      fn: () => Effect.runPromise(forConcurrentBounded4),
      verify: (v) => assert.equal(v, sum32)
    },
    {
      name: "$catch (success path)",
      fn: () => Effect.runSync(catchSuccessEffect),
      verify: (v) => assert.equal(v, 42)
    },
    {
      name: "$catch (failure recovery)",
      fn: () => Effect.runSync(catchFailEffect),
      verify: (v) => assert.equal(v, 99)
    },
    {
      name: "$catchExpression (success path)",
      fn: () => Effect.runSync(catchExprSuccess),
      verify: (v) => assert.equal(v, 42)
    },
    {
      name: "$produce + Stream.runFold (32 items)",
      async: true,
      fn: () => Effect.runPromise(consumeProducer),
      verify: (v) => assert.equal(v, sum32)
    }
  ]
})
