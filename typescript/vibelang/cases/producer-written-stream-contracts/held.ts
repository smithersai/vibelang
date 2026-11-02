import { Effect } from "effect"
import type { Scope } from "effect"
export const needsScope: Effect.Effect<number, never, Scope.Scope> = Effect.succeed(7)
