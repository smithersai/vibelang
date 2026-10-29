import { Effect } from "effect"

// No @throws: a function that returns an Effect can't throw (VIP-4).
export function loadTs(n: number): Effect.Effect<number> {
  return Effect.succeed(n)
}

export const twice = (n: number) => Effect.succeed(n * 2)

export const lookup = {
  find: (n: number): Effect.Effect<number> => Effect.succeed(n + 10),
}
