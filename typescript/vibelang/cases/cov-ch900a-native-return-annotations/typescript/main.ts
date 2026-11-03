import { Effect } from "effect"
function plain(): number { throw "bad" }
function* producer(): Generator<number> { throw "bad" }
export function main() { return Effect.gen(function* () {
 const a = yield* Effect.exit(Effect.try(() => plain()))
 const b = yield* Effect.exit(Effect.try(() => producer().next()))
 return [a._tag, b._tag]
}) }
