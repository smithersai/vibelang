import { Effect } from "effect"
export type Success = Effect.Effect<number | string>
export type Failure = Effect.Effect<number, string | Error>
export type Requirements = Effect.Effect<number, never, string | symbol>
export type Branch = string extends string ? Effect.Effect<number> : boolean
export type FunctionSlot = Effect.Effect<number, () => string>
export type Check = Effect.Effect<number> extends object ? true : false
