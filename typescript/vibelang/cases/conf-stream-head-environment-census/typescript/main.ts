import { ev } from "vip-events"
import { Effect, Stream } from "effect"

export function main() {
 return Effect.gen(function* () {
  ev("0")
  let probe: () => unknown = () => 0
  let stream: Stream.Stream<number> = Stream.empty
  // A native for-of creates the RHS's never-initialized head binding.
  for (const x of (probe = () => x, stream = Stream.fromIterable([1]), [] as number[])) {}
  yield* Stream.runForEachWhile(stream, (x) => Effect.sync(() => { ev("item" + x); return true }))
  return yield* Effect.sync(() => { try { probe(); return "read" } catch (e) { return (e as Error).name } })
 })
}
