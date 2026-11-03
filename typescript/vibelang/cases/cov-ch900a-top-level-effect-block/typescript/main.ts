import { Effect } from "effect"
const program = Effect.gen(function* () { return 1 })
export function main() { return Effect.gen(function* () { return yield* program }) }
