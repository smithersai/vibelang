import { Context, Data, Effect } from "effect"
import { legacy } from "./legacy.js"
class Numbers extends Context.Service<Numbers, { value: number }>()("Numbers") {}
class Bad extends Data.TaggedError("Bad") {}
function read() { return Effect.gen(function* () {
  const numbers = yield* Numbers
  if (numbers.value < 0) return yield* Effect.fail(new Bad())
  return numbers.value
}) }
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const success: Equal<Effect.Success<ReturnType<typeof read>>, number> = true
const failure: Equal<Effect.Error<ReturnType<typeof read>>, Bad> = true
const required: Equal<Effect.Services<ReturnType<typeof read>>, Numbers> = true
export function main(): Effect.Effect<readonly [boolean, boolean, boolean, number], unknown> {
  return Effect.map(Effect.try(() => legacy(1, 2)), n => [success, failure, required, n] as const)
}
