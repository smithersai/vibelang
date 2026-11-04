import { completedFiber } from "./fiber.js"
import { Effect, Fiber, Deferred } from "effect"
async function bridge(fiber: Fiber.Fiber<number>, deferred: Deferred.Deferred<number>) {
 const rawFiber = await fiber
 const rawDeferred = await deferred
 const a = await Effect.runPromise(Fiber.join(fiber))
 const b = await Effect.runPromise(Deferred.await(deferred))
 return [rawFiber === fiber, rawDeferred === deferred, a, b]
}
export function main() { return Effect.gen(function* () {
 const f = completedFiber()
 const d = yield* Deferred.make<number>()
 yield* Deferred.succeed(d,8)
 return yield* Effect.promise(() => bridge(f,d))
}) }
