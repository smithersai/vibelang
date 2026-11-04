import { Effect } from "effect"

type Outcome = { readonly kind: "ok"; readonly value: number }
export const observed: number[] = []

export const event = (bad: boolean) => Effect.gen(function* (): Effect.fn.Return<Outcome, string> {
  if (bad) return yield* Effect.fail("bad")
  observed.push(1)
  return { kind: "ok", value: 7 }
})

export const clock = () => Effect.gen(function* (): Generator<Effect.Effect<unknown>, Outcome, never> {
  yield* Effect.void
  return { kind: "ok", value: 9 }
})
