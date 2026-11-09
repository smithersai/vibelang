import { Context, Effect } from "effect"
export const Counter = Context.Reference<number>("Counter", { defaultValue: () => 0 })
export const task = Effect.succeed(1)
