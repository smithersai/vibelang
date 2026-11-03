import { Effect } from "effect"

// A tag in a TypeScript file is not EK0406: @throws and @rethrows describe TypeScript declarations (VIP-4).
/** @throws {Error} @rethrows f */
export function tsLoad(f: () => number): Effect.Effect<number> {
  return Effect.succeed(f())
}
