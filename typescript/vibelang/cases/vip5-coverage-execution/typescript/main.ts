import { Effect, Exit } from "effect"
export function completed(): Effect.Effect<number> { return Effect.gen(function* () { return yield* Effect.succeed(7) }) }
export function main(): Effect.Effect<readonly unknown[]> { return Effect.gen(function* () {
  let runs = 0
  const inner = Effect.sync(() => { runs++; return 3 })
  const held = Effect.gen(function* () { return inner })
  const returned = yield* held
  const fromSuccess = yield* Effect.succeed(inner)
  const fromHandler = yield* Effect.catch(Effect.fail("bad"), () => Effect.succeed(inner))
  const before = runs
  const ran = yield* returned
  const value = yield* fromSuccess
  const handlerValue = yield* fromHandler
  const failed = yield* Effect.exit(Effect.gen(function* () { yield* Effect.fail("propagated"); return "unreachable" }))
  const recovered = yield* Effect.catch(Effect.fail("bad"), (e: string) => Effect.succeed(e.length))
  const refailed = yield* Effect.exit(Effect.gen(function* () { return yield* Effect.catch(Effect.fail("first"), (e: string) => Effect.gen(function* () { return yield* Effect.fail(e + " again") })) }))
  let assigned: number = 0
  assigned = yield* Effect.catch(Effect.fail("missing"), () => Effect.succeed(9))
  const success = yield* Effect.catch(Effect.succeed(4), () => Effect.succeed((() => { runs += 100; return 0 })()))
  return [before, runs, returned === inner, fromSuccess === inner, fromHandler === inner,
    ran, value, handlerValue,
    Exit.isFailure(failed) && failed.cause.reasons[0]?._tag === "Fail" && failed.cause.reasons[0].error === "propagated",
    recovered,
    Exit.isFailure(refailed) && refailed.cause.reasons[0]?._tag === "Fail" && refailed.cause.reasons[0].error === "first again",
    assigned, success]
}) }
