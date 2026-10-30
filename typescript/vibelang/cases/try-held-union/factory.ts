import { $try } from "vibelang-runtime"
import * as Effect from "effect/Effect"
import * as Config from "effect/Config"
import * as Exit from "effect/Exit"
export interface LeftRequirement { readonly side: "left" }
export interface RightRequirement { readonly side: "right" }
export type RequiredOperand = Effect.Effect<number, "left", LeftRequirement> | Effect.Effect<string, "right", RightRequirement>
export const left: Effect.Effect<number, "left"> = Effect.succeed(1)
export const right: Effect.Effect<string, "right"> = Effect.succeed("s")
export const reference = (p: typeof left | typeof right) => Effect.gen(function* () { return yield* p })

export const legacy = $try<number, "left", never>(left)

export function unreachable(p: never) {
  return Effect.gen(function* () { return yield* ($try(p)) })
}

export const configValue = Config.succeed("cfg")
export const exitValue = Exit.succeed(2)
