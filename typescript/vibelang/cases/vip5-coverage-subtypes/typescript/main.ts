import { Effect, Effectable, Exit, Config } from "effect"
class Custom extends Effectable.Class<number> { asEffect() { return Effect.succeed(4) } }
interface Branded extends Effect.Effect<number> { readonly brand: "ok" }
const branded: Branded = Object.assign(Effect.succeed(5), { brand: "ok" as const })
const adapter = { asEffect() { return Effect.succeed(6) } }
export function main(): Effect.Effect<readonly number[], Effect.Error<Config.Config<number>>> { return Effect.gen(function* () {
  return [yield* Exit.succeed(8), yield* Config.succeed(7), yield* new Custom(), yield* branded, yield* adapter.asEffect()]
}) }
