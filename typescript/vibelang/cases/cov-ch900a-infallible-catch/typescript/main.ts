import { Effect } from "effect"
export function main() {
  return Effect.gen(function* () { return yield* Effect.catch(Effect.succeed(2), () => Effect.succeed(0)) 
  })
}
