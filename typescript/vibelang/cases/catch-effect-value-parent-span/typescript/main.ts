import { Effect } from "effect"
export const hasParent = (): Effect.Effect<boolean> =>
  Effect.map(Effect.catch(Effect.currentParentSpan, () => Effect.succeed(undefined)),
    parent => parent !== undefined && typeof parent.spanId === "string")
export const main = () => Effect.gen(function* () {
  const outside = yield* hasParent()
  const inside = yield* Effect.withSpan(hasParent(), "parent")
  return { outside, inside }
})
