import { Effect, Exit, Fiber, Stream, Scope, Context, Layer, Config, Data } from "effect"
export function main() { return Effect.gen(function* () {
 const observations: unknown[] = []
 for (const bad of [false, true]) {
  const events: string[] = []
  function id() { return Effect.gen(function* () { events.push("id"); if (bad) return yield* Effect.fail("no id"); return 7 }) }
  function worker(n: number) { return Effect.gen(function* () { events.push("worker"); return yield* Effect.fail("worker failed") }) }
  const result = yield* Effect.exit(Effect.gen(function* () {
   const n = yield* id()
   const f = yield* Effect.forkChild(Effect.catch(worker(n), () => Effect.sync(() => {events.push("handler"); return 0})))
   events.push("started")
   yield* Fiber.join(f)
   return "started"
  }))
  observations.push({events, tag: result._tag, value: result._tag === "Success" ? result.value : result.cause.reasons.map(r => r._tag === "Fail" ? r.error : r._tag)})
 }
 return observations
}) }
