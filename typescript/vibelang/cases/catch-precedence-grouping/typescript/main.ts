import { Effect } from "effect"
export function main() { return Effect.gen(function* () {
  const missing: Effect.Effect<number, string> | undefined = undefined
  const a = yield* Effect.catch(missing ?? Effect.fail("first"), () => Effect.succeed(1))
  const b = yield* Effect.catch(missing || Effect.fail("second"), () => Effect.succeed(2))
  const c = yield* Effect.catch(Effect.succeed(99) && Effect.fail("third"), () => Effect.succeed(3))
  const d = (yield* Effect.catch(Effect.fail("fourth"), () => Effect.succeed(4))) ?? 0
  const zero: number = 0
  const absent: number | undefined = undefined
  const truthy: number = 1
  const e = yield* Effect.catch(Effect.fail("fifth"), () => Effect.succeed(absent ?? 5))
  const f = yield* Effect.catch(Effect.fail("sixth"), () => Effect.succeed(zero || 6))
  const g = yield* Effect.catch(Effect.fail("seventh"), () => Effect.succeed(truthy && 7))
  const h = (yield* Effect.catch(Effect.fail("eighth"), () => Effect.succeed([8])))[0]
  return [a, b, c, d, e, f, g, h]
}) }
