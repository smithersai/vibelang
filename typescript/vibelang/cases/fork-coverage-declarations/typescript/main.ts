import { Effect } from "effect"
export function fork(): Effect.Effect<number> { return Effect.succeed(1) }
const methods = { join() { return Effect.succeed(2) } }
export function main(): Effect.Effect<number> { return methods.join() }
