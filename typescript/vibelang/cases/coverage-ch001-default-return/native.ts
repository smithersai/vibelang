import { Effect } from "effect"
export function g(x?: unknown): Effect.Effect<number | null> {
 if (x === undefined) return Effect.succeed(null)
 return Effect.succeed(1)
}
const good: Effect.Effect<number | null> = g()
export const f = g

