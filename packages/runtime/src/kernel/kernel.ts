// VibeLang continuation kernel prototype on effect@4.1.0.
//
// The kernel adds multi-prompt, one-shot delimited control to Effect's own
// fiber stack. A handler installs a Prompt frame on `fiber._stack` and an
// evidence entry in the fiber Context. Performing an operation looks up its
// evidence in the Context:
//   - InPlace evidence (services, tail-resumptive handlers) runs the
//     implementation at the perform site, in the caller's Context.
//   - Prompt evidence captures the frames between the perform site and the
//     handler's Prompt frame as a one-shot Continuation, restores the state
//     recorded by the Prompt, and runs the handler clause there.
// Nothing here uses Effect.gen semantics for control: capture and resumption
// operate on Effect's real continuation frames, so any code that leaves its
// state in those frames (generators, flatMap chains, TS-authored Effect
// combinators running on the same fiber) can be captured.
import { Cause, Context, Effect, Exit, Scope } from "effect"
import {
  asInternals,
  contA,
  contAll,
  contE,
  type FiberInternals,
  restoreInterruptible,
  setFailCause
} from "./internals.js"

setFailCause((cause) => Effect.failCause(cause))

// ---------------------------------------------------------------------------
// Defects raised by the kernel
// ---------------------------------------------------------------------------

export class UnhandledOperation extends Error {
  readonly _tag = "UnhandledOperation"
  constructor(readonly op: string) {
    super(`No handler for operation ${op}`)
  }
}

export class HandlerNotOnThisFiber extends Error {
  readonly _tag = "HandlerNotOnThisFiber"
  constructor(readonly op: string) {
    super(`The handler for ${op} is installed on another fiber; control handlers do not cross fork boundaries`)
  }
}

export class HandlerPromptExited extends Error {
  readonly _tag = "HandlerPromptExited"
  constructor(readonly op: string) {
    super(`The handler for ${op} has exited; a continuation that outlives it cannot perform ${op}`)
  }
}

export class ContinuationAlreadyConsumed extends Error {
  readonly _tag = "ContinuationAlreadyConsumed"
  constructor(readonly op: string, readonly state: ContinuationState) {
    super(`Continuation captured at ${op} was already ${state}`)
  }
}

export class ContinuationWrongFiber extends Error {
  readonly _tag = "ContinuationWrongFiber"
  constructor(readonly op: string) {
    super(`Continuation captured at ${op} can only be consumed on the fiber that captured it`)
  }
}

export class AbandonedContinuationContinued extends Error {
  readonly _tag = "AbandonedContinuationContinued"
  constructor(readonly op: string) {
    super(`Continuation captured at ${op} was abandoned but returned normally instead of unwinding`)
  }
}

export class TransferIntoOwnRegion extends Error {
  readonly _tag = "TransferIntoOwnRegion"
  constructor(readonly op: string) {
    super(`transfer of ${op} targets a Scope inside the continuation it would own`)
  }
}

export class NoScopeForTransfer extends Error {
  readonly _tag = "NoScopeForTransfer"
  constructor(readonly op: string) {
    super(`transfer needs a Scope region around the handler of ${op}`)
  }
}

// A parallel Scope runs each finalizer on a forked fiber
// (internal/effect.ts scopeCloseFinalizers), and consumption is fiber-affine,
// so its close could never abandon the continuation.
export class TransferIntoParallelScope extends Error {
  readonly _tag = "TransferIntoParallelScope"
  constructor(readonly op: string) {
    super(`transfer of ${op} targets a Scope with parallel finalizers, which run on other fibers and cannot abandon it`)
  }
}

// ---------------------------------------------------------------------------
// Pending-interruption bookkeeping
//
// Abandonment marks the fiber as interrupted with a sentinel cause so that the
// abandoned segment cannot resume normal work (the "sticky abort"). Each
// abandonment gets its own negative sentinel id; real fiber ids are positive.
// The sentinel is combined with, never substituted for, real pending
// interruptions, and only the abandonment that added it removes it.
// ---------------------------------------------------------------------------

let abortIds = 0

const isAbortReason = (reason: Cause.Reason<unknown>) =>
  Cause.isInterruptReason(reason) && reason.fiberId !== undefined && reason.fiberId < 0

/**
 * Whether cause carries an abandonment's sentinel interrupt: a control
 * operation unwinding its continuation, which code must not recover from.
 */
export const isAbortCause = (cause: Cause.Cause<unknown>): boolean => cause.reasons.some(isAbortReason)

const isAbortReasonOf = (abortId: number) => (reason: Cause.Reason<unknown>) =>
  Cause.isInterruptReason(reason) && reason.fiberId === abortId

const keep = <E = never>(cause: Cause.Cause<E> | undefined, predicate: (reason: Cause.Reason<unknown>) => boolean) => {
  if (cause === undefined) return undefined
  const kept = cause.reasons.filter(predicate)
  if (kept.length === cause.reasons.length) return cause
  return kept.length === 0 ? undefined : (Cause.fromReasons(kept) as Cause.Cause<E>)
}

// Defect precedence (D305). Effect 4.1.0 applies it wherever it combines a
// failure with a finalizer's or a sibling's cause (causeElectDefects,
// internal/effect.ts; Effect-TS/effect#9433) and in every typed recovery
// (findRecoverableError; #9516): when a cause holds a Die, each Fail becomes a
// Die of the same error, in place, with its annotations. A Stream's Done
// signal stays a Fail so pulls still complete. The kernel applies the same
// rule where it combines causes itself.
export const electDefects = <E>(cause: Cause.Cause<E>): Cause.Cause<E> => {
  const reasons = cause.reasons
  if (!reasons.some(Cause.isDieReason) || !reasons.some(Cause.isFailReason)) return cause
  return Cause.fromReasons(reasons.map((reason): Cause.Reason<E> =>
    Cause.isFailReason(reason) && !Cause.isDone(reason.error)
      ? Cause.annotate(Cause.die(reason.error), Cause.reasonAnnotations(reason)).reasons[0] as Cause.Reason<E>
      : reason
  ))
}

const addInterrupts = (pending: Cause.Cause<never> | undefined, extra: Cause.Cause<never> | undefined) =>
  pending === undefined ? extra : extra === undefined ? pending : Cause.combine(pending, extra)

// Append the interrupts of `pending` that `cause` does not already carry.
// Effect's skip loop has usually copied them in already (the same reason
// objects), so this mirrors causeAddInterrupts (internal/core.ts:331).
const withPendingInterrupts = (cause: Cause.Cause<unknown> | undefined, pending: Cause.Cause<never>) => {
  if (cause === undefined) return pending as Cause.Cause<unknown>
  const reasons = cause.reasons.slice()
  for (const reason of pending.reasons) {
    if (!Cause.isInterruptReason(reason)) continue
    const present = reasons.some((r) =>
      r === reason ||
      (Cause.isInterruptReason(r) && r.fiberId === reason.fiberId && r.annotations === reason.annotations)
    )
    if (!present) reasons.push(reason)
  }
  return reasons.length === cause.reasons.length ? cause : Cause.fromReasons(reasons)
}

// Entering a masked state must not leave a deferred interrupt behind: the run
// loop delivers that flag without checking interruptibility. The request
// itself stays in _interruptedCause and is delivered when the mask ends.
const setInterruptibility = (fiber: FiberInternals, value: boolean) => {
  fiber.interruptible = value
  if (!value) fiber._deferredInterrupt = false
}

// ---------------------------------------------------------------------------
// Operations and evidence
// ---------------------------------------------------------------------------

type Clause = (payload: any, k: Continuation) => Effect.Effect<any, any, any>

export interface HandlerInstance {
  readonly label: string
  readonly fiberId: number
  readonly clauses: Readonly<Record<string, Clause>>
  readonly onReturn: ((value: any) => Effect.Effect<any, any, any>) | undefined
}

export type Evidence =
  | { readonly _tag: "InPlace"; readonly run: (payload: any) => Effect.Effect<any, any, any> }
  | { readonly _tag: "Prompt"; readonly handler: HandlerInstance }

// An operation's contract: payload P, success A, and the expected failures E
// a handler may deliver at the perform site with resumeWith.
export interface Operation<P, A, E = never> {
  readonly name: string
  readonly key: Context.Key<any, Evidence>
  (payload: P): Effect.Effect<A, E>
}

export const operation = <P, A, E = never>(name: string): Operation<P, A, E> => {
  const key = Context.Service<Evidence>(`vibelang/operation/${name}`) as unknown as Context.Key<any, Evidence>
  const op = ((payload: P) => perform(op, payload)) as Operation<P, A, E>
  Object.defineProperty(op, "name", { value: name })
  ;(op as any).key = key
  return op
}

// Tail-resumptive evidence: the implementation runs at the perform site in
// the caller's Context. This is exactly Effect's service-method semantics.
export const provideInPlace = <P, A, E, R>(
  op: Operation<P, A, any>,
  run: (payload: P) => Effect.Effect<A, E, R>
) =>
<B, E2, R2>(self: Effect.Effect<B, E2, R2>) =>
  Effect.provideService(self, op.key, { _tag: "InPlace", run } as Evidence)

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

// Delimits a handled computation. On exit (any path) it restores the Context
// and interruptibility that were current where it was pushed: the `handle`
// site when installed, or the `resume` site when reinstalled.
class PromptFrame {
  readonly esFrame = "Prompt"
  constructor(
    readonly handler: HandlerInstance,
    readonly outerContext: Context.Context<never>,
    readonly outerInterruptible: boolean
  ) {}
  [contAll](fiber: FiberInternals) {
    fiber.setContext(this.outerContext)
    setInterruptibility(fiber, this.outerInterruptible)
    if (this.outerInterruptible && fiber._interruptedCause) {
      const cause = fiber._interruptedCause
      return () => Effect.failCause(cause)
    }
    return undefined
  }
  [contA](value: unknown) {
    return this.handler.onReturn ? this.handler.onReturn(value) : Effect.succeed(value)
  }
}

// Sits directly above Owner(k) for the whole clause invocation and performs a
// tail-resume request the clause returns (see `tailResume`). By then the
// clause's own frames, generator frames included, are gone, so `resumeWith`
// finds Owner(k) on top and drops it. No contE and no identifier: failures and
// interruption pass straight through it to Owner(k).
class ClauseFrame {
  readonly esFrame = "Clause"
  constructor(readonly k: Continuation) {}
  [contA](value: unknown) {
    return value instanceof TailResume ? resumeWith(value.target, value.effect) : Effect.succeed(value)
  }
}

// Owns a captured continuation for the duration of one handler-clause
// invocation. If the clause finishes (success, failure, or interruption)
// while the continuation is still suspended and has not been transferred, the
// continuation is abandoned before control leaves the invocation.
class OwnerFrame {
  readonly esFrame = "Owner"
  constructor(readonly k: Continuation) {}
  private owns() {
    return this.k.state === "suspended" && this.k.owner === "invocation"
  }
  [contAll](fiber: FiberInternals) {
    // Must be uninterruptible while abandoning, and must stop the
    // interruption skip loop in exitFailCause (internal/core.ts:613-621).
    if (this.owns() && fiber.interruptible) {
      setInterruptibility(fiber, false)
      fiber._stack.push(restoreInterruptible(true))
    }
    return undefined
  }
  [contA](value: unknown) {
    if (!this.owns()) return Effect.succeed(value)
    return Effect.flatMap(abandonNow(this.k), (unwound) => afterAbandon(Exit.succeed(value), unwound))
  }
  [contE](cause: Cause.Cause<unknown>) {
    if (!this.owns()) return Effect.failCause(cause)
    return Effect.flatMap(abandonNow(this.k), (unwound) => afterAbandon(Exit.failCause(cause), unwound))
  }
}

// Bottom of an abandoned segment: removes this abandonment's sentinel, restores
// the abandoner's Context and interruptibility, and hands the unwinding's Exit
// back. A real interruption still pending is delivered at once if the
// abandoner was interruptible, combined with the unwinding's own failures:
// only the sentinel is removed, so a cleanup defect is never dropped (K12).
class AbandonCollector {
  readonly esFrame = "AbandonCollector"
  constructor(
    readonly k: Continuation,
    readonly context: Context.Context<never>,
    readonly interruptible: boolean,
    readonly abortId: number
  ) {}
  [contAll](fiber: FiberInternals) {
    setInterruptibility(fiber, false)
    return undefined
  }
  private finish(fiber: FiberInternals, unwound: Exit.Exit<unknown, unknown>) {
    fiber.setContext(this.context)
    const own = isAbortReasonOf(this.abortId)
    const pending = keep(fiber._interruptedCause, (r) => !own(r))
    fiber._interruptedCause = pending
    setInterruptibility(fiber, this.interruptible)
    if (fiber.interruptible && pending) {
      const cleanup = Exit.isFailure(unwound) ? keep(unwound.cause, (r) => !own(r)) : undefined
      return Effect.failCause(withPendingInterrupts(cleanup, pending))
    }
    return Effect.succeed(unwound)
  }
  [contA](_value: unknown, fiber: FiberInternals) {
    return this.finish(fiber, Exit.die(new AbandonedContinuationContinued(this.k.op)))
  }
  [contE](cause: Cause.Cause<unknown>, fiber: FiberInternals) {
    return this.finish(fiber, Exit.failCause(cause))
  }
}

// Combine the boundary's own Exit with whatever the abandoned segment's
// finalizers produced, giving defects precedence as Effect's own finalizers
// do (electDefects, D305). Interruption reasons are not reported here: the
// abandonment's own sentinel is internal, and a real interruption that arrived
// meanwhile is still pending on the fiber and will be delivered by it.
const afterAbandon = (exit: Exit.Exit<unknown, unknown>, unwound: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(unwound)) return exit
  const extra = unwound.cause.reasons.filter((r) => r._tag !== "Interrupt")
  if (extra.length === 0) return exit
  const finalizerCause = Cause.fromReasons(extra)
  return Exit.failCause(electDefects(Exit.isSuccess(exit) ? finalizerCause : Cause.combine(exit.cause, finalizerCause)))
}

// A continuation cannot outlive the fiber that captured it: only that fiber
// can resume or abandon it, so once the fiber exits nobody could ever release
// the segment (Codex review R5). The first `transfer` on a fiber installs this
// frame at the bottom of its stack. When the fiber's computation finishes by
// any path, the frame abandons every transferred continuation still
// suspended, newest first, before the fiber's Exit is published; cleanup
// failures join that Exit, as at an Owner frame (K13).
class FiberExitFrame {
  readonly esFrame = "FiberExit"
  readonly transferred = new Set<Continuation>()
  private suspended() {
    const out: Array<Continuation> = []
    for (const k of this.transferred) if (k.state === "suspended") out.unshift(k)
    return out
  }
  [contAll](fiber: FiberInternals) {
    // Same masking as OwnerFrame: abandon uninterruptibly, and stop the
    // interruption skip loop here.
    if (fiber.interruptible && this.suspended().length > 0) {
      setInterruptibility(fiber, false)
      fiber._stack.push(restoreInterruptible(true))
    }
    return undefined
  }
  [contA](value: unknown) {
    return this.release(Exit.succeed(value))
  }
  [contE](cause: Cause.Cause<unknown>) {
    return this.release(Exit.failCause(cause))
  }
  private release(exit: Exit.Exit<unknown, unknown>): Effect.Effect<unknown, unknown> {
    const pending = this.suspended()
    this.transferred.clear()
    if (pending.length === 0) return exit
    return Effect.suspend(() => {
      let result = exit
      return Effect.flatMap(
        Effect.forEach(pending, (k) => Effect.map(abandonNow(k), (unwound) => void (result = afterAbandon(result, unwound))), {
          discard: true
        }),
        () => result
      )
    })
  }
}

const exitFrames = new WeakMap<FiberInternals, FiberExitFrame>()

const registerTransferred = (fiber: FiberInternals, k: Continuation) => {
  let frame = exitFrames.get(fiber)
  // stack[0] is checked because a transfer made while the frame itself is
  // releasing (inside a finalizer at fiber exit) needs a fresh bottom frame.
  if (frame === undefined || fiber._stack[0] !== frame) {
    frame = new FiberExitFrame()
    exitFrames.set(fiber, frame)
    fiber._stack.unshift(frame)
  }
  frame.transferred.add(k)
}

const forgetTransferred = (fiber: FiberInternals, k: Continuation) => {
  if (k.owner !== "invocation") exitFrames.get(fiber)?.transferred.delete(k)
}

// ---------------------------------------------------------------------------
// Continuations
// ---------------------------------------------------------------------------

export type ContinuationState = "suspended" | "resumed" | "abandoned"

let continuationIds = 0

export class Continuation {
  readonly id = ++continuationIds
  state: ContinuationState = "suspended"
  // "invocation" while the capturing clause owns it; a fresh token per transfer.
  owner: "invocation" | object = "invocation"
  constructor(
    readonly op: string,
    readonly fiberId: number,
    public segment: Array<any> | undefined,
    readonly context: Context.Context<never>,
    readonly interruptible: boolean,
    readonly handler: HandlerInstance,
    // An abandonment that was unwinding inside this segment when it was
    // captured; reinstated when the segment runs again.
    readonly stickyAbort: Cause.Cause<never> | undefined,
    // The Context outside the prompt, where the clause runs.
    readonly outerContext: Context.Context<never>
  ) {}
  get frameCount() {
    return this.segment?.length ?? 0
  }
}

// A transferred continuation: first-class, owned by a Scope region.
export class Suspended {
  constructor(readonly k: Continuation) {}
}

const unwrap = (target: Continuation | Suspended) => (target instanceof Suspended ? target.k : target)

// A tail-resume request: the value a compiled clause RETURNS (never yields)
// when its last action is resuming. `return yield* resume(k, v)` inside a
// generator clause keeps the clause's Iterator frame above Owner(k) until the
// resumed computation finishes, so a producer leaks two frames per element
// (Codex R10, Fable finding 1). `return tailResume(k, v)` ends the generator
// first; the ClauseFrame under it then resumes with Owner(k) on top, which
// `resumeWith` drops: constant stack (K11). Only for a resume in tail
// position: one that no try/catch/finally or `using` region of the clause
// encloses. Inside such a region the compiler must emit `yield* resume(...)`,
// because the region's cleanup has to run after the resumed computation.
export class TailResume {
  readonly _tag = "TailResume"
  constructor(readonly target: Continuation | Suspended, readonly effect: Effect.Effect<any, any, any>) {}
}

export const tailResume = <A>(target: Continuation | Suspended, value: A): TailResume =>
  new TailResume(target, Exit.succeed(value))

export const tailResumeWith = (target: Continuation | Suspended, effect: Effect.Effect<any, any, any>): TailResume =>
  new TailResume(target, effect)

// Observers for tracing. Tests use these to print the machine state.
export const hooks: {
  onCapture?: (fiber: FiberInternals, k: Continuation) => void
  onResume?: (fiber: FiberInternals, k: Continuation) => void
} = {}

export const perform = <P, A, E>(op: Operation<P, A, E>, payload: P): Effect.Effect<A, E> =>
  Effect.withFiber((f) => {
    const fiber = asInternals(f)
    const evidence = Context.getOrUndefined(fiber.context, op.key) as Evidence | undefined
    if (evidence === undefined) return Effect.die(new UnhandledOperation(op.name))
    if (evidence._tag === "InPlace") return evidence.run(payload)
    return capture(fiber, op.name, evidence.handler, payload)
  }) as Effect.Effect<A, E>

const capture = (fiber: FiberInternals, opName: string, handler: HandlerInstance, payload: unknown) => {
  const stack = fiber._stack
  let i = stack.length - 1
  while (i >= 0 && !(stack[i] instanceof PromptFrame && stack[i].handler === handler)) i--
  if (i < 0) {
    return Effect.die(
      handler.fiberId === fiber.id ? new HandlerPromptExited(opName) : new HandlerNotOnThisFiber(opName)
    )
  }
  const prompt = stack[i] as PromptFrame
  const segment = stack.splice(i + 1)
  stack.pop()
  // An abandonment unwinding inside the captured segment stays with it: the
  // clause runs outside that segment and must not see its sentinel.
  const pending = fiber._interruptedCause
  const stickyAbort = keep(pending, isAbortReason)
  fiber._interruptedCause = keep(pending, (r) => !isAbortReason(r))
  const k = new Continuation(
    opName,
    fiber.id,
    segment,
    fiber.context,
    fiber.interruptible,
    handler,
    stickyAbort,
    prompt.outerContext
  )
  hooks.onCapture?.(fiber, k)
  // The clause runs at the prompt, with the prompt's outer state.
  fiber.setContext(prompt.outerContext)
  setInterruptibility(fiber, prompt.outerInterruptible)
  stack.push(new OwnerFrame(k))
  stack.push(new ClauseFrame(k))
  if (fiber.interruptible && fiber._interruptedCause) return Effect.failCause(fiber._interruptedCause)
  const clause = handler.clauses[opName]!
  return clause(payload, k)
}

// Resume with a value, or by running an Effect at the perform site
// (Effect.fail(e) raises a typed failure the body may catch).
export const resume = <A>(target: Continuation | Suspended, value: A) => resumeWith(target, Exit.succeed(value))

export const resumeWith = (
  target: Continuation | Suspended,
  effect: Effect.Effect<any, any, any>
): Effect.Effect<any, any, any> =>
  Effect.withFiber((f) => {
    const fiber = asInternals(f)
    const k = unwrap(target)
    if (k.state !== "suspended") return Effect.die(new ContinuationAlreadyConsumed(k.op, k.state))
    if (k.fiberId !== fiber.id) return Effect.die(new ContinuationWrongFiber(k.op))
    k.state = "resumed"
    forgetTransferred(fiber, k)
    const segment = k.segment!
    k.segment = undefined
    const stack = fiber._stack
    // A resume in tail position of its clause: the clause's Owner frame is now
    // inert (k is no longer suspended), so drop it, with the ClauseFrame above
    // it when the clause itself returned this resume (flatMap-shaped clause).
    // A tailResume request arrives with the ClauseFrame already popped.
    // Without this, a producer iterated n times would hold n Owner frames
    // until iteration ends.
    let top = stack.length - 1
    if (stack[top] instanceof ClauseFrame && stack[top].k === k) top--
    if (stack[top] instanceof OwnerFrame && stack[top].k === k) stack.length = top
    // Deep handler: reinstall the prompt at the resume site.
    stack.push(new PromptFrame(k.handler, fiber.context, fiber.interruptible))
    for (let j = 0; j < segment.length; j++) stack.push(segment[j])
    fiber.setContext(k.context)
    setInterruptibility(fiber, k.interruptible)
    fiber._interruptedCause = addInterrupts(fiber._interruptedCause, k.stickyAbort)
    hooks.onResume?.(fiber, k)
    if (fiber.interruptible && fiber._interruptedCause) return Effect.failCause(fiber._interruptedCause)
    return effect
  })

// Unwind a suspended continuation: its finalizers run, recovery handlers for
// typed failures do not, and the result is the unwinding's Exit.
//
// Abandonment is fiber-affine, like resumption. Effect frames are closures
// over the fiber that pushed them: updateContext's restore frame calls
// setContext on that fiber (internal/effect.ts:2200-2208). Unwinding a segment
// on another fiber would rewrite the capturing fiber's live Context
// (tests/kernel-edges.test.ts, T14b).
export const abandonNow = (target: Continuation | Suspended): Effect.Effect<Exit.Exit<unknown, unknown>> =>
  Effect.withFiber((f) => {
    const fiber = asInternals(f)
    const k = unwrap(target)
    if (k.state !== "suspended") return Effect.succeed(Exit.void as Exit.Exit<unknown, unknown>)
    if (k.fiberId !== fiber.id) return Effect.die(new ContinuationWrongFiber(k.op))
    k.state = "abandoned"
    forgetTransferred(fiber, k)
    const segment = k.segment!
    k.segment = undefined
    const abortId = -(++abortIds)
    const abortCause = Cause.interrupt(abortId) as Cause.Cause<never>
    const stack = fiber._stack
    stack.push(new AbandonCollector(k, fiber.context, fiber.interruptible, abortId))
    for (let j = 0; j < segment.length; j++) stack.push(segment[j])
    fiber.setContext(k.context)
    // Sticky abort: like a real interruption, it is re-delivered whenever the
    // segment re-enters an interruptible region. It joins, and never replaces,
    // real pending interruptions.
    fiber._interruptedCause = addInterrupts(addInterrupts(fiber._interruptedCause, k.stickyAbort), abortCause)
    setInterruptibility(fiber, k.interruptible)
    return Effect.failCause(abortCause)
  })

// Abandon and report: finalizer failures and AbandonedContinuationContinued
// fail the caller; the abort itself is not reported.
export const abandon = (target: Continuation | Suspended): Effect.Effect<void> =>
  Effect.flatMap(abandonNow(target), (unwound) => afterAbandon(Exit.void, unwound)) as Effect.Effect<void>

// Transfer ownership from the clause invocation to the Scope region around
// the handler: the Scope in the clause's Context. Closing that Scope abandons
// the continuation if it is still suspended and still owned by this transfer.
// The capturing fiber's exit is a second, unconditional owner: whatever the
// Scope has not consumed by then is abandoned on that fiber before it exits
// (FiberExitFrame), so a Scope that outlives the fiber (one inherited from a
// parent, or never closed) cannot strand the segment.
export const transfer = (k: Continuation): Effect.Effect<Suspended> =>
  Effect.withFiber((f) => {
    const fiber = asInternals(f)
    if (k.state !== "suspended") return Effect.die(new ContinuationAlreadyConsumed(k.op, k.state))
    if (k.fiberId !== fiber.id) return Effect.die(new ContinuationWrongFiber(k.op))
    const scope = Context.getOrUndefined(fiber.context, Scope.Scope)
    if (scope === undefined) return Effect.die(new NoScopeForTransfer(k.op))
    if (scope.strategy === "parallel") return Effect.die(new TransferIntoParallelScope(k.op))
    // Direct ownership cycle: the innermost Scope of the captured region can
    // close only by unwinding the continuation that would own it. Deeper
    // regions inside the segment are the checker's job (second-class k).
    const innermost = Context.getOrUndefined(k.context, Scope.Scope)
    if (scope === innermost && innermost !== Context.getOrUndefined(k.outerContext, Scope.Scope)) {
      return Effect.die(new TransferIntoOwnRegion(k.op))
    }
    const token = {}
    k.owner = token
    registerTransferred(fiber, k)
    return Effect.as(
      Scope.addFinalizer(scope, Effect.suspend(() => (k.state === "suspended" && k.owner === token ? abandon(k) : Effect.void))),
      new Suspended(k)
    )
  })

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const handle = <A, E, R>(
  label: string,
  ops: ReadonlyArray<Operation<any, any, any>>,
  body: Effect.Effect<A, E, R>,
  clauses: Readonly<Record<string, Clause>>,
  onReturn?: (value: A) => Effect.Effect<any, any, any>
): Effect.Effect<any, any, any> =>
  Effect.withFiber((f) => {
    const fiber = asInternals(f)
    const handler: HandlerInstance = { label, fiberId: fiber.id, clauses, onReturn }
    let context = fiber.context
    for (const op of ops) context = Context.add(context, op.key, { _tag: "Prompt", handler } as Evidence)
    fiber._stack.push(new PromptFrame(handler, fiber.context, fiber.interruptible))
    fiber.setContext(context)
    return body
  })

// ---------------------------------------------------------------------------
// Source `catch`
//
// VibeLang's `catch` recovers as Effect 4.1.0's Effect.catch does
// (findRecoverableError, Effect-TS/effect#9516; D305, D306): a cause with a
// defect re-fails with its failures elected to defects; otherwise the
// handler receives the first failure, and an interruption or a further
// failure beside it is dropped (K14). On Effect 4.0.5, Effect.catch also
// recovered a cause with a defect and dropped the defect (Codex review R1).
// One rule is VibeLang's own: a cause that carries an abandonment's sentinel
// interrupt passes through untouched, because recovering a failure raised
// while a handler abandons a continuation would resume abandoned code (K14d).
// ---------------------------------------------------------------------------

export const catchExpected = <A, E, R, B, E2, R2>(
  self: Effect.Effect<A, E, R>,
  handler: (error: E) => Effect.Effect<B, E2, R2>
): Effect.Effect<A | B, E2, R | R2> =>
  Effect.catchCause(self, (cause): Effect.Effect<B, E2, R2> => {
    if (isAbortCause(cause)) return Effect.failCause(cause as Cause.Cause<never>)
    if (cause.reasons.some(Cause.isDieReason)) return Effect.failCause(electDefects(cause) as Cause.Cause<never>)
    const failure = cause.reasons.find(Cause.isFailReason)
    return failure === undefined ? Effect.failCause(cause as Cause.Cause<never>) : handler((failure as Cause.Fail<E>).error)
  })

// ---------------------------------------------------------------------------
// Root-level one-shot suspension with an observable race outcome.
// Effect.callback silently ignores a resume that loses a race
// (internal/effect.ts:1155-1157); this adapter reports it so the producer
// can dispose a value nobody will receive.
// ---------------------------------------------------------------------------

export interface Resumer<A> {
  // true when the kernel accepted the value; false when the waiter was
  // already resumed or cancelled, in which case the caller still owns `value`.
  readonly resume: (value: A) => boolean
  readonly state: () => "waiting" | "resumed" | "cancelled"
}

// Effect 4.1.0 runs a woken fiber synchronously on the waker's JS stack with
// no depth guard (tests/wakeup-chain.test.ts: ~1,000 chained wake-ups on V8,
// ~3,000 on JSC overflow and silently strand the rest of the chain). The
// kernel bounds nesting: beyond wakeConfig.budget it enqueues the wake-up on
// the scheduler instead.
export const wakeConfig = { budget: 64 }
let wakeDepth = 0

type SchedulerThis = { makeDispatcher(): { scheduleTask(task: () => void, priority: number): void } }

// Shared delivery machinery for suspend and handoff. Values delivered while
// `register` is still running are held until it returns, so that a register
// that throws after accepting a value can still release it.
const makeDelivery = <A>(scheduler: SchedulerThis, resumeEffect: (effect: Effect.Effect<A>) => void) => {
  let inRegister = true
  let duringRegister: { readonly value: A } | undefined
  let inFlight: { readonly value: A } | undefined
  const deliverNow = (value: A) => {
    wakeDepth++
    try {
      resumeEffect(Effect.succeed(value))
    } finally {
      wakeDepth--
    }
  }
  return {
    deliver(value: A) {
      if (inRegister) {
        duringRegister = { value }
        return
      }
      if (wakeDepth < wakeConfig.budget) return deliverNow(value)
      // Deferred delivery: the kernel owns the value until the task runs.
      inFlight = { value }
      scheduler.makeDispatcher().scheduleTask(() => {
        const pending = inFlight
        inFlight = undefined
        if (pending !== undefined) deliverNow(pending.value)
      }, 0)
    },
    registered() {
      inRegister = false
      const held = duringRegister
      duringRegister = undefined
      if (held !== undefined) resumeEffect(Effect.succeed(held.value))
    },
    // Values the waiter will never receive: held during a failed register, or
    // in flight when cancellation won.
    undelivered(): Array<A> {
      const values = [duringRegister, inFlight].filter((v): v is { readonly value: A } => v !== undefined)
      duringRegister = undefined
      inFlight = undefined
      return values.map((v) => v.value)
    }
  }
}

export const suspend = <A>(
  register: (resumer: Resumer<A>) => (() => void) | void,
  options?: { readonly release?: (value: A) => void }
): Effect.Effect<A> =>
  Effect.callback<A>(function(this: SchedulerThis, resumeEffect: (effect: Effect.Effect<A>) => void) {
    let state: "waiting" | "resumed" | "cancelled" = "waiting"
    const delivery = makeDelivery<A>(this, resumeEffect)
    const releaseAll = () => {
      for (const value of delivery.undelivered()) options?.release?.(value)
    }
    let cleanup: (() => void) | void
    try {
      cleanup = register({
        resume(value) {
          if (state !== "waiting") return false
          state = "resumed"
          delivery.deliver(value)
          return true
        },
        state: () => state
      })
    } catch (error) {
      state = "cancelled"
      releaseAll()
      resumeEffect(Effect.die(error))
      return
    }
    delivery.registered()
    return Effect.sync(() => {
      if (state === "waiting") state = "cancelled"
      releaseAll()
      cleanup?.()
    })
  } as any)

// Handoff for producers that cannot act on a `false` from `resume`, such as
// event sources whose shutdown is asynchronous. Adapted from the independent
// Codex design (experiments/reference-machine/kernel.ts `handoff`).
//
// Protocol: `register` receives `deliver` and returns `cancelAndJoin`, an
// effect that completes only once the producer can no longer deliver. A value
// that arrives after cancellation began, or that the waiter will never
// receive, is passed to `releaseLate` exactly once, and cancellation completes
// only after that release.
export class HandoffProtocolViolation extends Error {
  readonly _tag = "HandoffProtocolViolation"
  constructor() {
    super("The producer delivered twice, or after acknowledging quiescence")
  }
}

export const handoff = <A>(
  register: (deliver: (value: A) => void) => Effect.Effect<void>,
  releaseLate: (value: A) => Effect.Effect<void>
): Effect.Effect<A> =>
  Effect.callback<A>(function(this: SchedulerThis, resumeEffect: (effect: Effect.Effect<A>) => void) {
    let state: "waiting" | "delivered" | "cancelled" | "closed" = "waiting"
    let late: { readonly value: A } | undefined
    const delivery = makeDelivery<A>(this, resumeEffect)
    let cancelAndJoin: Effect.Effect<void>
    try {
      cancelAndJoin = register((value) => {
        // After quiescence was acknowledged nobody can release a value: fail loudly.
        if (state === "closed") throw new HandoffProtocolViolation()
        if (state === "cancelled") {
          if (late !== undefined) throw new HandoffProtocolViolation()
          late = { value }
          return
        }
        if (state === "delivered") throw new HandoffProtocolViolation()
        state = "delivered"
        delivery.deliver(value)
      })
    } catch (error) {
      state = "closed"
      const values = delivery.undelivered()
      resumeEffect(Effect.andThen(Effect.forEach(values, releaseLate, { discard: true }), Effect.die(error)))
      return
    }
    delivery.registered()
    return Effect.suspend(() => {
      if (state === "waiting") state = "cancelled"
      const undelivered = delivery.undelivered()
      return Effect.andThen(cancelAndJoin, () => {
        state = "closed"
        const values = late === undefined ? undelivered : [...undelivered, late.value]
        late = undefined
        return Effect.forEach(values, releaseLate, { discard: true })
      })
    })
  } as any)
