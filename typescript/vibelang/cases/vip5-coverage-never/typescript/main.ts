import { Effect } from "effect"
// TypeScript rejects a direct yield* never (TS2488), despite accepting
// never's assignment to Effect. This type-only alias proves that predicate
// and delegates the identical value; it inserts no runtime conversion.
function bottom(value: never) { return Effect.gen(function* () {
  const checked: Effect.Effect<never> = value
  yield* checked
  return 0
}) }
export function main(): Effect.Effect<boolean> { return Effect.gen(function* () { return true }) }
