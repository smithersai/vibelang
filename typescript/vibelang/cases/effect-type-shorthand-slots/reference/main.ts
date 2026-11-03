import { Effect } from "effect"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type User = { readonly name: string }
type NotFound = { readonly _tag: "NotFound" }
type Users = { readonly users: unique symbol }
type Full = Effect.Effect<User, NotFound, Users>
type ErrorOnly = Effect.Effect<User, NotFound>
type NeedsOnly = Effect.Effect<User, never, Users>
type Neither = Effect.Effect<User>
export const checks: [
  Equal<Full, Effect.Effect<User, NotFound, Users>>,
  Equal<ErrorOnly, Effect.Effect<User, NotFound, never>>,
  Equal<NeedsOnly, Effect.Effect<User, never, Users>>,
  Equal<Neither, Effect.Effect<User, never, never>>,
  Equal<Array<Effect.Effect<User>>, Array<Effect.Effect<User>>>
] = [true, true, true, true, true]
function value(): Effect.Effect<number> { return Effect.succeed(7) }
function failure(): Effect.Effect<never, string> { return Effect.fail("missing") }
export function main() {
  return Effect.gen(function* () {
    return [yield* value(), yield* Effect.catch(failure(), e => Effect.succeed(e))]
  })
}
