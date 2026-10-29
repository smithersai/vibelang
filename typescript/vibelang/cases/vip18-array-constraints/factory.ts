import { Effect, Exit } from "effect"
export const values = [Effect.succeed(1), Effect.succeed(2)] as const
export interface Values extends ReadonlyArray<Effect.Effect<number>> {}
export const derived: Values = [Effect.succeed(3)]
export const empty: never[] = []
export const exits: ReadonlyArray<Exit.Exit<number, string>> = [Exit.succeed(4), Exit.fail("bad")]
