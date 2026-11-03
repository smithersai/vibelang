import { Effect, Context, Layer, Exit } from "effect"
class S extends Context.Service<S, { value: number }>()("S") {}
export function main(): Effect.Effect<Array<number | undefined>> {
 return Effect.gen(function* () {
  const trace: Array<number | undefined> = []
  const live = Layer.effect(S, Effect.acquireRelease(Effect.succeed({value:1}), (_, e) => Effect.sync(() => { trace.push(Exit.isSuccess(e) ? e.value as number | undefined : -1) })))
  yield* Effect.provide(Effect.uninterruptibleMask(() => Effect.gen(function* () { 7 })), live)
  trace.push(7)
  function returned() { return Effect.provide(Effect.uninterruptibleMask(() => Effect.succeed(7)), live) }
  trace.push(yield* returned())
  function returnedVoid() { return Effect.provide(Effect.uninterruptibleMask(() => Effect.void), live) }
  trace.push((yield* returnedVoid()) as undefined)
  for (const item of [0]) { yield* Effect.provide(Effect.uninterruptibleMask(() => Effect.void), live); break }
  for (const item of [0]) { yield* Effect.provide(Effect.uninterruptibleMask(() => Effect.void), live); continue }
  return trace
 })
}
