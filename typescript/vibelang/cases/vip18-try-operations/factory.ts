import { Effect } from "effect"
/** @throws {never} */
export const effects = (): ReadonlyArray<Effect.Effect<number>> | readonly [Effect.Effect<string>] => [Effect.succeed(5)]
export const values = [Effect.succeed(3), Effect.succeed(4)] as const

export const build = () => Effect.succeed([Effect.succeed(6)] as const)
