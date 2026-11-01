import { Context, Effect } from "effect"
export class Env extends Context.Service<Env, Effect.Effect<{ readonly accountId: string }>>()("Env") {}
export const creds = (): Effect.Effect<Effect.Effect<number>> => Effect.succeed(Effect.succeed(2))
export const held: Effect.Effect<Effect.Effect<number>> = Effect.succeed(Effect.succeed(3))
export const live = Effect.succeed({ accountId: "a-1" })
