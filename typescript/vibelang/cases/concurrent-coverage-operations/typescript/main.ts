import { Effect, Exit, Deferred } from "effect"
export function main(): Effect.Effect<[number[], string, string, string[]], string> {
 return Effect.gen(function* () {
  const ready = yield* Deferred.make<void>()
  const xs = yield* Effect.all([Effect.gen(function* () { yield* Deferred.await(ready); return 1 }), Effect.gen(function* () { yield* Deferred.succeed(ready, undefined); return 2 })], { concurrency: "unbounded" })
  const record = yield* Effect.all({ n: Effect.succeed(3) }, { concurrency: "unbounded" })
  xs.push(record.n)
  const raced = yield* Effect.catch(Effect.raceAllFirst([Effect.fail("first"), Effect.never]), e => Effect.succeed(e))
  const any = yield* Effect.raceAll([Effect.fail("ignored"), Effect.succeed("ok")])
  const settled = yield* Effect.all([Effect.exit(Effect.succeed(1)), Effect.exit(Effect.fail("failure")), Effect.exit(Effect.die("defect")), Effect.exit(Effect.interrupt)], { concurrency: "unbounded" })
  const tags = settled.map(e => Exit.isSuccess(e) ? "Success" : e.cause.reasons[0]._tag)
  return [xs, raced, any, tags]
 })
}
