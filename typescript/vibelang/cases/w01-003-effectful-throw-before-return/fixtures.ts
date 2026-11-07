import { Effect } from "effect"

export let calls = 0
// A `.ts` function whose return type is an Effect, so it is effectful and its
// thrown type is `never`, but whose implementation throws before returning.
export function early(): Effect.Effect<number> {
  calls++
  throw new Error("early")
}
