// TypeScript code is outside the migration: native TS1338.
import { Effect } from "effect"
export function native(): Effect.Effect<number, infer E> { return Effect.succeed(1) }
