import { Effect } from "effect"

// Runs an Effect to its Exit from plain code, as a constructor does.
export function runExit<A, E>(e: Effect.Effect<A, E, never>) { return Effect.runSyncExit(e) }
