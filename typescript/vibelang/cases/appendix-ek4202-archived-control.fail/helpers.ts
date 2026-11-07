// TypeScript functions: one whose declared requirements hold the control
// operation Approval, and a generic one whose requirements come from its
// argument.
import { Effect } from "effect"
import type { Approval } from "./approval.js"

export declare function retryApproval(request: string): Effect.Effect<boolean, never, Approval>

export const twice = <A, E, R>(program: Effect.Effect<A, E, R>): Effect.Effect<[A, A], E, R> =>
  Effect.zip(program, program)
