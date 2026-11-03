import { Effect } from "effect"
export function main(): Effect.Effect<number[]> {
 return Effect.gen(function* () {
  const out: number[] = []
  function returned() { return Effect.uninterruptibleMask(() => Effect.succeed(7)) }
  out.push(yield* returned())
  for (const x of [1, 2, 3]) {
    const completion = yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      if (x === 2) return "continue"
      yield* restore(Effect.sync(() => { out.push(x) }))
      if (x === 3) return "break"
      return "normal"
    }))
    if (completion === "continue") continue
    if (completion === "break") break
  }
  yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    yield* restore(Effect.uninterruptibleMask(inner => inner(Effect.gen(function* () {
      yield* Effect.yieldNow; out.push(4)
    }))))
    yield* Effect.interruptible(Effect.gen(function* () { yield* Effect.yieldNow; out.push(5) }))
  }))
  return out
 })
}
