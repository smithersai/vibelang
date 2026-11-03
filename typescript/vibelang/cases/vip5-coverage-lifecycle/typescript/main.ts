import { Effect, Exit, Fiber } from "effect"
export function main(): Effect.Effect<readonly unknown[]> { return Effect.gen(function* () {
  const events: string[] = []
  const final = Effect.sync(() => { events.push("ensuring") })
  const program = Effect.gen(function* () { events.push("body"); return yield* Effect.fail("stop") })
  const failed = yield* Effect.exit(Effect.onExit(Effect.ensuring(program,final), () => Effect.sync(() => { events.push("onExit") })))
  const child = yield* Effect.forkChild(Effect.gen(function* () { events.push("child") }))
  yield* Effect.succeed(1)
  events.push("parent")
  yield* Effect.yieldNow
  yield* Fiber.join(child)
  const order = events.slice()
  const caller: string[] = []
  function id(): Effect.Effect<number,string> { return Effect.gen(function* () { caller.push("id"); return yield* Effect.fail("id") }) }
  function work(n: number) { return Effect.gen(function* () { caller.push("work"); return n }) }
  const evaluated = yield* Effect.exit(Effect.gen(function* () { const f = yield* Effect.forkChild(work(yield* id())); return yield* Fiber.join(f) }))
  return [Exit.isFailure(failed),order,Exit.isFailure(evaluated),caller]
}) }
