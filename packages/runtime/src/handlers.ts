import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as K from "./kernel/kernel.js"
import { controls } from "./services.js"

declare const ContinuationBrand: unique symbol
/**
 * D50: the rest of a handled program, paused at an operation. `V` is what the
 * perform site receives, `E` the operation's declared errors (what
 * `resumeWith` may raise there), and `H` what `resume` returns: the value the
 * `handle` produces when the resumed program next reaches it. Usable only
 * inside its clause.
 */
export interface Continuation<V, E, H> {
  readonly [ContinuationBrand]: { readonly v: (_: V) => void; readonly e: E; readonly h: H }
}

/**
 * One clause per operation of the control `S` declares, each receiving the
 * operation's arguments and `k`. Every operation needs a clause: `handle`
 * removes the whole control from the program's requirements.
 */
type Clauses<S, H> = {
  readonly [M in keyof S as S[M] extends (...args: any) => Effect.Effect<any, any, any> ? M : never]-?: S[M] extends
    (...args: infer P) => Effect.Effect<infer V, infer E, any> ? (...args: [...P, k: Continuation<V, E, H>]) => Effect.Effect<any, any, any>
    : never
}
type ClauseEffects<C> = { [M in keyof C]: C[M] extends (...args: any) => infer F ? F : never }[keyof C]
// A clause's tail resume returns the kernel's request, never a value of the
// handle's result (generated TypeScript sees $tailResume's type).
type ClauseA<C> = ClauseEffects<C> extends infer F ? F extends Effect.Effect<infer A, any, any> ? Exclude<A, K.TailResume> : never
  : never
type ClauseE<C> = ClauseEffects<C> extends infer F ? F extends Effect.Effect<any, infer E, any> ? E : never : never
type ClauseR<C> = ClauseEffects<C> extends infer F ? F extends Effect.Effect<any, any, infer R> ? R : never : never

/**
 * `handle(program, Control, clauses, onReturn?)`: runs `program` with a deep
 * handler for `Control`'s operations. Each clause receives the operation's
 * arguments and `k`, the rest of the program. The result is what the program
 * returns (through `onReturn` when given) or what a clause returns without
 * resuming. Inside a clause, `resume(k, v)` has the program's own result type;
 * with `onReturn` it has type `never`, so a clause's tail `resume` adds
 * nothing to the result (D97).
 */
export function handle<A, E, R, I, S, C extends Clauses<S, A>>(
  program: Effect.Effect<A, E, R>,
  control: Context.Key<I, S>,
  clauses: C
): Effect.Effect<A | ClauseA<C>, E | ClauseE<C>, Exclude<R, I> | ClauseR<C>>
export function handle<A, E, R, I, S, C extends Clauses<S, never>, B, EB, RB>(
  program: Effect.Effect<A, E, R>,
  control: Context.Key<I, S>,
  clauses: C,
  onReturn: (value: A) => Effect.Effect<B, EB, RB>
): Effect.Effect<B | ClauseA<C>, E | EB | ClauseE<C>, Exclude<R, I> | RB | ClauseR<C>>
export function handle(
  program: Effect.Effect<any, any, any>,
  control: Context.Key<any, any>,
  clauses: Record<string, (...args: Array<any>) => Effect.Effect<any, any, any>>,
  onReturn?: (value: any) => Effect.Effect<any, any, any>
): Effect.Effect<any, any, any> {
  const info = controls.get(control)
  if (!info) return Effect.die(new Error(`${String((control as any).key)} is not a control operation`))
  const ops: Array<K.Operation<any, any, any>> = []
  const kclauses: Record<string, (payload: any, k: K.Continuation) => Effect.Effect<any, any, any>> = {}
  for (const [m, op] of Object.entries(info.ops)) {
    if (typeof clauses[m] !== "function") continue
    ops.push(op)
    const arity = info.arity[m] ?? -1
    kclauses[op.name] = (payload: Array<any>, k) => clauses[m](...fitArguments(payload, arity), k)
  }
  return K.handle(String((control as any).key), ops, Effect.provideService(program, control, info.impl as any), kclauses, onReturn)
}

/**
 * Pads a call's arguments to the operation's declared parameter count, so a
 * clause receives its continuation after every declared parameter even when
 * the call left an optional argument out. A count of -1 (a rest parameter, or
 * a control registered without counts) keeps the arguments as given.
 */
const fitArguments = (payload: Array<any>, arity: number): Array<any> =>
  arity < 0 || payload.length === arity
    ? payload
    : payload.length < arity
    ? [...payload, ...new Array<undefined>(arity - payload.length)]
    : payload.slice(0, arity)

/** Continues the program with `value` at the perform site; returns what the `handle` then produces. */
export const resume: <V, E, H>(k: Continuation<V, E, H>, value: NoInfer<V>) => Effect.Effect<H> = K.resume as any

/**
 * Continues the program by running `program` at the perform site (D17): it
 * may fail only with the operation's declared errors, and needs nothing
 * (EK2005).
 */
export const resumeWith: <V, E, H>(k: Continuation<V, E, H>, program: Effect.Effect<NoInfer<V>, NoInfer<E>, never>) => Effect.Effect<H> =
  K.resumeWith as any

/** Stops the program: its cleanup runs, its `catch` blocks do not. Fails if cleanup fails. */
export const abandon: <V, E, H>(k: Continuation<V, E, H>) => Effect.Effect<void> = K.abandon as any

/** D18: a clause's tail `resume` is returned as a request, never yielded (KERNEL-CHANGES.md section 1). */
export const $tailResume: <V, E, H>(k: Continuation<V, E, H>, value: NoInfer<V>) => K.TailResume = K.tailResume as any
export const $tailResumeWith: <V, E, H>(k: Continuation<V, E, H>, program: Effect.Effect<NoInfer<V>, NoInfer<E>, never>) => K.TailResume =
  K.tailResumeWith as any

type ClauseBinding<F> = F extends (...args: infer P) => Effect.Effect<infer V, infer E, any> ? [k: Continuation<V, E, never>, ...args: P]
  : never

/**
 * D132: what a clause of a handle statement binds, the continuation and then
 * the operation's arguments. For
 * `try { … } handle Approval.approve(request) { … }` the parser writes
 * `const [$k, request] = $clause(Approval.approve)` for the checker, and the
 * lowering removes it. The continuation's `resume` returns `never`: the
 * clause's result is what the rest of the try block does.
 */
export function $clause<F extends (...args: any) => Effect.Effect<any, any, any>>(_operation: F): ClauseBinding<F> {
  throw new Error("$clause types a handle clause's bindings; compiled code never calls it")
}
