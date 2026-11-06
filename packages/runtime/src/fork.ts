import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"

/** The options `fork` passes on to Effect's `forkIn`. */
type ForkOptions = Parameters<typeof Effect.forkScoped>[1]

/**
 * D19: `fork` is block-owned. Inside a Scope region the child is interrupted
 * when the block exits; outside one, `Scope` joins the caller's R.
 */
export function $fork<A, E, R>(program: Effect.Effect<A, E, R>, scope: Scope.Scope, options?: ForkOptions): Effect.Effect<Fiber.Fiber<A, E>, never, R>
export function $fork<A, E, R>(program: Effect.Effect<A, E, R>): Effect.Effect<Fiber.Fiber<A, E>, never, R | Scope.Scope>
export function $fork(program: Effect.Effect<any, any, any>, scope?: Scope.Scope, options?: ForkOptions): Effect.Effect<any, any, any> {
  return scope ? Effect.forkIn(program, scope, options) : Effect.forkScoped(program)
}

/** The prelude's `fork`, for TypeScript callers and type positions. */
export const fork = Effect.forkScoped
