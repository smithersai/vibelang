import { Effect } from "effect"
import { hostname, tag } from "./lib.js"
const quiet = Effect.fn(function* (n: number) { return n })
const annotated = (n: number): Effect.Effect<number> => Effect.succeed(n)
export const program = Effect.fn(function* (n: number) { yield* quiet(n); yield* hostname() })
export const reverse = Effect.fn(function* (n: number) { yield* hostname(); yield* quiet(n) })
export const control = Effect.fn(function* (n: number) { yield* annotated(n); yield* hostname() })
export const tagged = Effect.fn(function* (n: number) { yield* quiet(n); yield* tag() })
export const only = Effect.fn(function* (n: number) { return yield* quiet(n) })
