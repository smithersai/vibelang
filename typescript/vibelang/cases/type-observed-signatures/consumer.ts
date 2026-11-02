import { Effect } from "effect"
import { run, generic, inferred, inferredGeneric, plain, Failure } from "./main.vibe"
import type * as M from "./main.vibe"
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T
type Checks = [
  Assert<Eq<ReturnType<typeof run>, Effect.Effect<number, Failure, never>>>,
  Assert<Eq<Effect.Error<ReturnType<typeof run>>, Failure>>,
  Assert<Eq<Effect.Success<ReturnType<typeof run>>, number>>,
  Assert<Eq<Parameters<typeof run>, [n: number]>>,
  Assert<Eq<ReturnType<typeof generic>, Effect.Effect<unknown, Failure, never>>>,
  Assert<Eq<Parameters<typeof generic>, [value: unknown]>>,
  Assert<Eq<Effect.Error<ReturnType<typeof generic>>, Failure>>,
  Assert<Eq<Effect.Success<ReturnType<typeof generic>>, unknown>>,
  Assert<Eq<ReturnType<typeof inferred>, Effect.Effect<number, Failure, never>>>,
  Assert<Eq<Effect.Error<ReturnType<typeof inferred>>, Failure>>,
  Assert<Eq<Effect.Success<ReturnType<typeof inferred>>, number>>,
  Assert<Eq<Parameters<typeof inferred>, [n: number]>>,
  Assert<Eq<ReturnType<typeof inferredGeneric>, Effect.Effect<unknown, Failure, never>>>,
  Assert<Eq<Effect.Error<ReturnType<typeof inferredGeneric>>, Failure>>,
  Assert<Eq<Effect.Success<ReturnType<typeof inferredGeneric>>, unknown>>,
  Assert<Eq<Parameters<typeof inferredGeneric>, [value: unknown]>>,
  Assert<Eq<ReturnType<typeof plain>, Effect.Effect<number, never, never>>>,
  Assert<Eq<typeof run extends (...args: any[]) => Effect.Effect<any, Failure, never> ? true : false, true>>,
  Assert<Eq<Extract<keyof typeof M, "run" | "generic">, "run" | "generic">>
]
