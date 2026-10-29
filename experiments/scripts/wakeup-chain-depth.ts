// F10 on the current host: how far a chain of synchronous Deferred wake-ups
// gets on effect@4.1.0 before one fiber dies with RangeError.
// Run from experiments/: node scripts/wakeup-chain-depth.ts   (or: bun scripts/wakeup-chain-depth.ts)
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"

const chain = (N: number) => Effect.gen(function*() {
  const gates = yield* Effect.forEach(Array.from({ length: N + 1 }), () => Deferred.make<number>())
  const fibers: Array<Fiber.Fiber<unknown, unknown>> = []
  let reached = -1
  for (let i = 0; i < N; i++) {
    fibers.push(yield* Effect.forkChild(Effect.flatMap(Deferred.await(gates[i]!), (n) => {
      reached = n
      return Deferred.succeed(gates[i + 1]!, n + 1)
    })))
  }
  yield* Effect.yieldNow
  yield* Deferred.succeed(gates[0]!, 0)
  yield* Effect.sleep("50 millis")
  const dead = fibers.map((f) => f.pollUnsafe()).filter((e) => e !== undefined && Exit.isFailure(e))
  const first = dead[0] && Exit.isFailure(dead[0]) ? String(Cause.squash(dead[0].cause)).slice(0, 48) : "none"
  return `N=${N}: last hop reached ${reached}, finished ${yield* Deferred.isDone(gates[N]!)}, dead fibers ${dead.length} (${first})`
})

const host = typeof (globalThis as any).Bun !== "undefined" ? `bun ${(globalThis as any).Bun.version}` : `node ${process.version}`
for (const N of [500, 1_000, 5_000, 20_000]) {
  console.log(`${host} ${await Effect.runPromise(chain(N))}`)
}
