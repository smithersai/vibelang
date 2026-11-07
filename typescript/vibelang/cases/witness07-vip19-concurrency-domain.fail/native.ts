import { Effect } from "effect"
import type { Types } from "effect"

// The same operands against stock Effect 4.1.1.
export const literal = Effect.forEach([1], (x) => Effect.succeed(x), { concurrency: "inherit", discard: true })
export const numeric = (n: number) => Effect.forEach([1], (x) => Effect.succeed(x), { concurrency: n, discard: true })
export const unbounded = Effect.forEach([1], (x) => Effect.succeed(x), { concurrency: "unbounded", discard: true })
export const pinned = (c: Types.Concurrency) => Effect.forEach([1], (x) => Effect.succeed(x), { concurrency: c, discard: true })
