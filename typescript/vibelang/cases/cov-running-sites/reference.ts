// Chapter 2: explicit Effect TypeScript counterpart.
import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
const nativeRun = Effect.runSync(Effect.succeed(11))
class Counter extends Context.Service<Counter, { value: number }>()("cov/Counter") {}
export function main() { return Effect.gen(function* () {
 const events: string[] = []
 let runs = 0
 const task = Effect.gen(function* () { runs++; return runs })
 const before = runs
 const first = yield* task
 const second = yield* task
 const unary = (yield* Effect.succeed(6)) + 1
 const fallback = yield* Effect.catch(Effect.fail("bad"), e => Effect.succeed(e.length))
 const fiber = yield* Effect.forkChild(Effect.succeed(8))
 const joined = yield* Fiber.join(fiber)
 const failed = yield* Effect.exit(Effect.fail("failed"))
 const all = yield* Effect.all([Effect.succeed(1), Effect.succeed(2)], { concurrency: "unbounded" })
 const raced = yield* Effect.raceAllFirst([Effect.succeed(3)])
 const any = yield* Effect.raceAll([Effect.fail("bad"), Effect.succeed(4)])
 const settled = yield* Effect.all([Effect.exit(Effect.succeed(5)), Effect.exit(Effect.fail("bad"))], { concurrency: "unbounded" })
 let active = 0, maximum = 0
 yield* Effect.forEach([1, 2, 3], item => Effect.gen(function* () {
   active++; maximum = Math.max(maximum, active); yield* Effect.yieldNow; active--
 }), { concurrency: "unbounded", discard: true })
 const seen: number[] = []
 yield* Stream.runForEachWhile(Stream.make(1, 2), item => Effect.sync(() => { seen.push(item); return true }))
 let supplied = 0
 yield* Effect.provide(Effect.gen(function* () { supplied = (yield* Counter).value }), Layer.succeed(Counter, { value: 9 }))
 yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () { events.push("mask"); yield* restore(Effect.sync(() => { events.push("restore") })) }))
 yield* Effect.interruptible(Effect.sync(() => { events.push("interruptible") }))
 events.push("limit"); const limit = 1
 events.push("items"); const items = [1]
 yield* Effect.forEach(items, item => Effect.sync(() => { events.push("item") }), { concurrency: limit, discard: true })
 const config = yield* Config.succeed(7)
 const exitValue = yield* Exit.succeed(8)
 return { nativeRun, before, first, second, unary, fallback, joined, failed: failed._tag, all, raced, any, settled: settled.map(x => x._tag), maximum, seen, supplied, config, exitValue, events }
}) }
