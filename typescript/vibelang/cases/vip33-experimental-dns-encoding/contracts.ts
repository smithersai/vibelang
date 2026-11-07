import type * as Actual from "./main.vibe"
import type * as Native from "./native.ts"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<A extends true> = A
export type Contracts = [
  Assert<Equal<Effect.Success<ReturnType<typeof Actual.node>>, Effect.Success<ReturnType<typeof Native.node>>>>,
  Assert<Equal<Effect.Error<ReturnType<typeof Actual.worker>>, never>>,
  Assert<Equal<Effect.Services<ReturnType<typeof Actual.workerWithoutSockets>>, never>>,
  Assert<Equal<ReturnType<typeof Actual.decode>, ReturnType<typeof Native.decode>>>,
]
import type * as Effect from "effect/Effect"
