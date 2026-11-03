import { Effect } from "effect"
export function main() { return Effect.gen(function* () {
  let n = 0
  yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
    n += yield* Effect.succeed(1)
    yield* restore(Effect.gen(function* () { n += yield* Effect.succeed(2) }))
  }))
  yield* Effect.interruptible(Effect.gen(function* () { n += yield* Effect.succeed(4) }))
  return n
}) }
