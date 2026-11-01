import { Effect } from "effect"
import type { Db } from "./main.vibe"

// Held Effects: a .ts module builds them without running them.
export const poll: Effect.Effect<number> = Effect.succeed(1)
export const needsDb: Effect.Effect<number, never, Db> = Effect.succeed(2)
