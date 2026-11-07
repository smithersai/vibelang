import { Effect } from "effect"
export const program = Effect.gen(function* () {
  Effect.succeed(0)
  const direct = Effect.runSync(Effect.succeed(1))
  const nested = () => Effect.runSync(Effect.succeed(2))
  return direct + nested()
})
