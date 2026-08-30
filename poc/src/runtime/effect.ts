import { errorNominalKey, errorRowIncludes, isLocalError } from "./errors.ts";
import {
  __vsCloseScope,
  __vsInScope,
  __vsLayerEntries,
  __vsOpenScope,
  type CapabilityKey,
  type CapabilityService,
  type EnvironmentScope,
} from "./layer.ts";
import { isPanic, panic } from "./panic.ts";
import { __vsInspectResult, __vsResultFailure, isResult, type Result } from "./result.ts";

/**
 * The handler / one-shot-continuation runtime.
 *
 * `specification/effects.mdx` is normative for everything in this file. It is
 * cited by section throughout; where it is silent the code fails closed and the
 * gap is written down as a question rather than settled here.
 *
 * Nothing in this module is spellable in `.sm`, and nothing re-exports it yet:
 * `runtime/index.ts` does not name it, so no authored program can reach a
 * request, a continuation, or a handler. §One-Shot Delimited Continuations
 * requires exactly that ("MUST NOT be reified as a value visible to authored
 * `.sm`"), and §What This Page Does Not Add requires that the convention never
 * be named in a diagnostic — so every message below names the *program's*
 * mistake, never the generator that carries it.
 *
 * ## Scope of this module
 *
 * Synchronous generators only. `yield*` cannot cross the sync/async generator
 * boundary, so the emitted calling convention has to pick one globally; that
 * choice is not made here and is recorded as question Q-A below. Consequently
 * `await using` and asynchronous disposal are out of scope: `using` and
 * `finally` are covered, `await using` is not.
 *
 * ## Questions recorded, not answered
 *
 * Where `specification/effects.mdx` is silent this module fails closed and the
 * gap is written down. Each of these needs a sentence of specification that
 * does not exist today.
 *
 * **Q-A — sync or async generators, globally.** `yield*` cannot delegate from a
 * sync generator to an async one, so the emitted convention must be one or the
 * other everywhere. §Abandonment names `await using`, which implies async
 * disposal, but nothing on the page says how an emitted body performs an
 * `await`. Three shapes are available and the page does not choose: async
 * generators throughout; sync generators with `await` lowered into a `perform`
 * request answered by an async driver; or sync only.
 *
 * **Q-B — asynchronous disposal on abandonment.** §Abandonment requires "every
 * live `using` and `await using` scope in the abandoned computation MUST be
 * disposed". A synchronous unwind cannot await a `[Symbol.asyncDispose]`, so on
 * a sync convention an abandoned `await using` is either unsatisfiable or makes
 * the handler's own result a promise. Follows from Q-A.
 *
 * **Q-C — a disposal error raised during abandonment.** Already marked open on
 * the page. This implementation gives that open item a concrete consequence:
 * because the unwind runs inside `Continuation.abandon`, a disposal error is
 * thrown out of the handler's own `answer` call and *is* observable to a
 * handler that wraps it in `try`. Whether that is the intended answer is not
 * decided here.
 *
 * **Q-D — an abort whose failure identity is outside the frame's declared row.**
 * §Effect Rows defines `E` as the failure identities a function may fail with;
 * the page does not say what a runtime must do when an abort's identity is not
 * one of them. {@link resultFrame} panics. Fails closed, not settled.
 *
 * **Q-E — the third resumption arm.** §Handlers names two outcomes, resume and
 * decline. A generator has three resumptions and `gen.throw` is observably
 * distinct from both — it runs the body's `catch` clauses — so a conforming
 * runtime must either use it or forbid it. {@link Continuation.raise} exists
 * for the host exception channel and refuses panic values.
 *
 * This paragraph used to end "and is unreachable from any specified kind."
 * **That was false, and it was load-bearing.** `raise` is offered on every
 * request a handler accepts, and until 2026-08-28 nothing refused it: a handler
 * accepting an `abort` could answer with `raise`, re-enter the aborted
 * computation through its `catch` clause, and complete it successfully — a
 * declared failure swallowed and the computation resumed, which §Effect
 * Requests forbids outright ("the handler MUST NOT resume"). The `abort` and
 * `get` rows are now closed to `raise` by {@link RESUMPTION_MATRIX}, which
 * states all nine cells. What is genuinely open is the one cell that table
 * marks unsanctioned: `perform` + `raise`, neither of the page's two outcomes.
 * It is admitted, and the reason is written beside the cell rather than
 * asserted as an impossibility here.
 *
 * **Q-F — a request issued while a computation is unwinding.** A `yield` inside
 * a `finally` block suspends `gen.return()` and `gen.throw()` alike. Two
 * consequences, one closed here and one that cannot be:
 *
 * - On abandonment the runtime can see it, and {@link unwind} refuses.
 * - **On a panic it cannot.** A panic raised inside a `try` whose `finally`
 *   issues a request surfaces at the driver as an ordinary request, with the
 *   panic held by the engine; a handler that then declines discards it. So on a
 *   generator lowering, §Panic Is Not a Request — "A handler MUST NOT be able
 *   to convert a panic into a resumption" — is **not enforceable at runtime**.
 *   It needs a static rule about what a `finally` may contain, and the page
 *   states none. `SMITHERS1205` refuses `!` inside a `try` with a `catch`
 *   clause, which is a different and narrower condition. `effect.test.ts` pins
 *   the hole as measured behaviour rather than papering over it.
 *
 * **Q-G — concurrent submission.** The occurrence index here is assigned in
 * program order by a single-threaded driver. Ordering *concurrent* siblings is
 * the deterministic-submission-index question `concurrency/scheduler.ts` holds,
 * and this module deliberately does not import it; wiring the two together is
 * not part of proving the primitive.
 */

/** §Effect Requests: "A request MUST have exactly one of three kinds". */
export type RequestKind = "get" | "perform" | "abort";

/**
 * §Effect Requests: "a key — a nominal identity the compiler derives from
 * source and that is stable across modules and compilations". The runtime never
 * interprets a key; it compares by identity only, exactly as `errorIs` treats a
 * failure constructor as "a compiler-resolved nominal key".
 */
export type RequestKey = object | string | symbol;

declare const requestAnswer: unique symbol;

/**
 * §Effect Requests. The answer type is carried in a phantom, *covariant*
 * position and nowhere else.
 *
 * That is not decoration. Emitted `.ts` is checked by stock tsc
 * (`language/validate.ts` `checkEmittedTypeScript`), never by the `.sm`
 * frontend, so the union has to be a type stock TypeScript can infer through
 * `yield*` delegation chains. A generator's yield type is checked covariantly
 * against the delegate's, so `A` may only appear covariantly — the moment a
 * request carries its own resume callback (`resume: (a: A) => void`, the
 * obvious shape) `A` turns contravariant, `EffectRequest<Clock>` stops being
 * assignable to `EffectRequest<unknown>`, and every delegation chain that mixes
 * two answer types fails to check. The `out` annotation makes that a build
 * error here rather than a mystery in emitted code.
 */
export interface EffectRequest<out A = unknown> {
  readonly kind: RequestKind;
  readonly key: RequestKey;
  readonly input: unknown;
  /**
   * §Effect Requests: "content-addressed from the request's source position and
   * its enclosing function's identity". Opaque to the runtime; produced by
   * `durable/site-id.ts`'s scheme in real emission.
   */
  readonly site: string;
  /**
   * §Effect Requests: "plus an occurrence index assigned at dispatch". Absent
   * until the innermost delimiter dispatches the request, and never reassigned
   * — a forwarded request keeps the index it was dispatched with.
   */
  readonly occurrence?: number;
  readonly [requestAnswer]?: A;
}

/** The whole request union, as an outer generator's yield type. */
export type AnyRequest = EffectRequest<unknown>;

/** A request that has been dispatched, and therefore carries its index. */
export type DispatchedRequest<A = unknown> = EffectRequest<A> & { readonly occurrence: number };

/**
 * §Effect Rows: "A function's effect row is the pair `(E, R)`".
 *
 * `failures` is `E`, `capabilities` is `R`. The two are not interchangeable and
 * the runtime keys different obligations on each: emission in the resumable
 * convention is refused when *both* are empty (§Effect Rows), while the
 * completed-value assertion in {@link runHandled} keys on `failures` alone,
 * because the error variant it checks for only exists when `E` is non-empty
 * (§Propagation Is an Abort Request).
 */
export interface EffectRow {
  readonly failures: readonly RequestKey[];
  readonly capabilities: readonly RequestKey[];
}

/**
 * The one-shot resumption ABI, as offered to a handler.
 *
 * The three methods are the three ways a generator can be resumed, and they are
 * observably different in the body:
 *
 * | method      | driver call | body sees            | `catch` | `finally` / `using` |
 * | ----------- | ----------- | -------------------- | ------- | ------------------- |
 * | `resume(a)` | `next(a)`   | the request's answer | —       | —                   |
 * | `raise(e)`  | `throw(e)`  | a throw at the site  | **runs**| runs                |
 * | `abandon(r)`| `return()`  | nothing              | skipped | runs                |
 *
 * The `catch` column holds at **every** nesting depth. It did not until
 * 2026-08-28: a frame that forwarded the request outward re-threw an outer
 * handler's `raise` instead of delivering it inward, so at depth two the body's
 * `catch` was skipped and the error escaped as a host exception. See the
 * forwarding arm of {@link handle}.
 *
 * `resume` is the answer of a `get` or a `perform`. `abandon` is §Abandonment.
 * `raise` is the host exception channel; which request kinds may be answered
 * with it is {@link RESUMPTION_MATRIX}, not this table — `abort` and `get` both
 * refuse it, and `perform` is the one cell the page does not sanction.
 *
 * A continuation is resumable **at most once** (§One-Shot Delimited
 * Continuations) and stops being resumable once its frame has moved on.
 */
export interface Continuation<B> {
  /** Answer the request and resume. */
  resume(answer: unknown): void;
  /** Raise at the suspension point. Runs the body's `catch` clauses. */
  raise(error: unknown): void;
  /**
   * Decline to resume. Unwinds the abandoned computation immediately —
   * §Abandonment requires the unwind to happen "before the handler's own result
   * is produced", and doing it here rather than after `answer` returns makes
   * that ordering observable to the handler itself.
   */
  abandon(result: B): void;
}

/**
 * §Handlers: "A handler delimits a computation and answers requests issued
 * within that computation's dynamic extent."
 *
 * `B` is the handler's own result type, produced only when it declines to
 * resume. A handler that resumes never produces a result of its own — the
 * delimited computation's value is the frame's value.
 */
export interface Handler<B> {
  /** Whether this handler accepts the request's key. */
  accepts(request: DispatchedRequest): boolean;
  /**
   * Answer an accepted request. MUST call exactly one of the continuation's
   * three methods; calling none is an invariant failure, and calling a second
   * is the one-shot violation.
   */
  answer(request: DispatchedRequest, continuation: Continuation<B>): void;
}

/** The emitted calling convention: a body is a generator over the union. */
export type Resumable<A> = Generator<AnyRequest, A, unknown>;

const localRequests = new WeakSet<object>();

interface Execution {
  occurrence: number;
}

/**
 * The occurrence counter is execution-scoped, and this is the only ambient
 * state in the module. It is *not* a handler environment: §Extent Is Structural
 * requires handler environments to live on the handler's own stack, and they do
 * — every `handle` frame is a generator frame. Saved and restored around a run
 * exactly as `layer.ts` does with `currentPromiseOrigin`.
 */
let currentExecution: Execution | undefined;

/**
 * The answer type is phantom, so a fresh request is legitimately a request for
 * any answer type; this is the single place that fact is spelled, and it is why
 * the emitted lowering hooks below need no cast on the request itself.
 */
function makeRequest<A>(kind: RequestKind, key: RequestKey, input: unknown, site: string): EffectRequest<A> {
  if (typeof site !== "string" || site.length === 0) panic("an effect request site identity is missing");
  const request: EffectRequest<A> = { kind, key, input, site };
  localRequests.add(request);
  return request;
}

function assertLocalRequest(request: AnyRequest): void {
  if (typeof request !== "object" || request === null || !localRequests.has(request)) {
    panic("forged effect request");
  }
}

/**
 * §Effect Requests: the occurrence index is "assigned at dispatch". Dispatch is
 * one event, so the index is assigned by the innermost delimiter and preserved
 * unchanged when an outer handler forwards the request.
 */
function dispatch(request: AnyRequest): DispatchedRequest {
  assertLocalRequest(request);
  if (request.occurrence !== undefined) return request as DispatchedRequest;
  const execution = currentExecution;
  if (execution === undefined) panic("an effect request was dispatched outside a running program");
  Object.defineProperty(request, "occurrence", {
    value: execution.occurrence,
    enumerable: true,
    writable: false,
    configurable: false,
  });
  execution.occurrence += 1;
  Object.freeze(request);
  return request as DispatchedRequest;
}

/**
 * Unwind an abandoned computation.
 *
 * `gen.return()` does not always complete a generator: a `yield` inside a
 * `finally` block honours the yield first and leaves the generator suspended,
 * answering `{ done: false }`. Dropping that request would leave the abandoned
 * computation live and holding whatever it acquired after that point, which
 * §Abandonment forbids outright ("A runtime MUST NOT allow an abandoned
 * computation to leave a resource undisposed"). What a request issued *during*
 * an unwind should mean is not specified, so this fails closed rather than
 * choosing an answer for it.
 */
function unwind<A>(gen: Generator<AnyRequest, A, unknown>): void {
  const step = gen.return(undefined as never);
  if (!step.done) panic("an effect request was issued while its computation was being abandoned");
}

type DecisionMode = "resume" | "raise" | "abandon";

interface Decision {
  readonly mode: DecisionMode;
  readonly value: unknown;
}

/**
 * THE decision × kind matrix, every one of the nine cells stated.
 *
 * §Effect Requests' kind table constrains the *resumption*, not the request, so
 * the obligation is a relation between a request's kind and the arm of the
 * resumption ABI a handler chose. It is written out here rather than as a
 * sequence of `if`s next to {@link handle}'s decision because the shape of the
 * bug it replaces was exactly that: two guards covering four cells, silently
 * admitting the five they did not mention. `Record<RequestKind, Record<
 * DecisionMode, …>>` makes tsc refuse a table with a missing cell, so a fourth
 * request kind or a fourth resumption arm cannot be added without answering for
 * every combination.
 *
 * A value is the panic message that refuses the cell; `undefined` permits it.
 *
 * | kind \ arm | `resume`             | `raise`               | `abandon`            |
 * | ---------- | -------------------- | --------------------- | -------------------- |
 * | `get`      | permitted (required) | **refused**           | **refused**          |
 * | `perform`  | permitted            | permitted — see below | permitted            |
 * | `abort`    | **refused**          | **refused**           | permitted (required) |
 *
 * - `get` — "the handler MUST resume with the capability instance". Both
 *   non-resume arms are refused; that was already enforced and still is.
 * - `abort` — "the handler MUST NOT resume". `raise` **is** a resumption: it
 *   re-enters the aborted computation at its suspension point and runs its
 *   `catch` clauses, so a handler could answer a declared failure with `raise`
 *   and have the computation complete successfully, swallowing it. Until
 *   2026-08-28 only the `resume` arm of this row was refused and `raise` was
 *   the way through. It is refused with the same message, because the message
 *   must name the program's mistake — propagating a failure and then resuming
 *   it — and never the generator convention that carries it (§What This Page
 *   Does Not Add).
 * - `perform` + `raise` — the page's two sanctioned outcomes are "resume with
 *   the answer" and "MUST NOT resume", and this is neither, so it is
 *   **unsanctioned rather than permitted by the page**. It is admitted here,
 *   and that is question Q-E left open rather than settled: it is the host
 *   exception channel {@link Continuation.raise} exists for, refusing it would
 *   decide Q-E in this module instead of on the page, and unlike the `abort`
 *   cell it cannot swallow a declared failure — a declared failure only ever
 *   travels as an `abort`, whose whole row is now closed to `raise`.
 */
const RESUMPTION_MATRIX: {
  readonly [Kind in RequestKind]: { readonly [Mode in DecisionMode]: string | undefined };
} = {
  get: {
    resume: undefined,
    raise: "a capability read was not answered",
    abandon: "a capability read was not answered",
  },
  perform: {
    resume: undefined,
    raise: undefined,
    abandon: undefined,
  },
  abort: {
    resume: "a failure propagation was resumed",
    raise: "a failure propagation was resumed",
    abandon: undefined,
  },
};

class OneShotContinuation<B> implements Continuation<B> {
  #taken = false;
  #expired = false;
  decision: Decision | undefined;
  readonly #unwind: () => void;

  constructor(unwind: () => void) {
    this.#unwind = unwind;
  }

  resume(answer: unknown): void {
    this.#take("resume", answer);
  }

  raise(error: unknown): void {
    // §Panic Is Not a Request: a handler "MUST NOT be able to convert a panic
    // into a resumption". `raise` runs the body's `catch` clauses, so injecting
    // a panic through it would be exactly the implicit swallow that
    // `specification/failures.mdx` forbids. Refused rather than allowed.
    if (isPanic(error)) panic("a panic cannot be delivered into a suspended computation");
    this.#take("raise", error);
  }

  abandon(result: B): void {
    this.#take("abandon", result);
    // §Abandonment: unwind "before the handler's own result is produced".
    this.#unwind();
  }

  /** Called by the frame once it has acted on the decision. */
  expire(): void {
    this.#expired = true;
  }

  #take(mode: DecisionMode, value: unknown): void {
    // Order matters and both arms are reachable. Inside `answer` the frame is
    // still live, so a second call is the one-shot violation; after `answer`
    // returns the frame has moved on, so a stashed continuation reports the
    // stronger fact — §One-Shot Delimited Continuations: "A computation that
    // has completed, or that a handler has declined to resume, MUST NOT be
    // resumable."
    if (this.#expired) {
      panic("a suspended computation that is no longer live cannot be resumed");
    }
    if (this.#taken) {
      // §One-Shot Delimited Continuations: "MUST treat a second resumption of
      // the same continuation as an invariant failure".
      panic("a suspended computation was resumed more than once");
    }
    this.#taken = true;
    this.decision = { mode, value };
  }
}

/**
 * A wrapper every entry INTO the delimited computation passes through.
 *
 * The default runs the step directly, and every existing caller gets exactly
 * that. `__vsProvide` supplies one that enters its AsyncLocalStorage frame,
 * because an un-lowered `.sm` capability read — a property accessor, a host
 * callback — has no generator frame to carry a request and still has to find
 * its layer. It wraps the four places a step happens (creation, `next`,
 * `throw`, and the unwind) rather than the whole run: between them the frame is
 * suspended and the request belongs to whatever encloses THIS handler.
 */
export type StepGuard = <T>(step: () => T) => T;

const stepDirectly: StepGuard = (step) => step();

/**
 * §Handlers. Installs `handler` around `body` and forwards outward, unchanged,
 * every request `handler` does not accept.
 *
 * Nesting is structural: the delimiter *is* this generator frame, so the
 * innermost enclosing `handle` that accepts a key is the one that answers it,
 * with no ambient handler registry and no revocation step (§Extent Is
 * Structural).
 */
export function* handle<A, B>(
  handler: Handler<B>,
  body: () => Resumable<A>,
  around: StepGuard = stepDirectly,
): Generator<AnyRequest, A | B, unknown> {
  const gen = around(body);
  let mode: "next" | "throw" = "next";
  let carried: unknown;
  try {
    for (;;) {
      const step: IteratorResult<AnyRequest, A> = around(() =>
        mode === "next" ? gen.next(carried) : gen.throw(carried));
      // A throw out of `gen.next`/`gen.throw` is not a request and is never
      // offered to `handler`. That is §Panic Is Not a Request, and it is
      // structural: only `step.value` below ever reaches a handler.
      if (step.done) return step.value;
      const request = dispatch(step.value);
      if (!handler.accepts(request)) {
        // §Handlers: "A handler that does not accept a key MUST forward the
        // request outward unchanged." Same object, same occurrence index.
        //
        // Forwarding is transparent in BOTH directions. An outer handler that
        // answers with `raise` throws at this frame's own `yield`, and without
        // the catch arm below that throw left `handle` instead of reaching the
        // computation the request came from: the body's `catch` clauses were
        // skipped, its `finally` still ran, and the error surfaced as a host
        // exception. Recovery then depended on how many frames happened to sit
        // between the raising handler and the body — an author cannot reason
        // about that, and the ABI table above promises the `catch` runs. Only
        // the delegating `yield` is wrapped: a throw out of `gen.next` /
        // `gen.throw` is the body's own and is never re-delivered to it.
        try {
          carried = yield request;
          mode = "next";
        } catch (raised) {
          // §Panic Is Not a Request: a panic "MUST unwind past every handler".
          // `Continuation.raise` already refuses to carry one, so a panic
          // arriving here is something else unwinding through a suspended
          // frame — an outer `answer` that panicked, or the top-of-program
          // refusal — and delivering it inward would hand the body's `catch` a
          // panic to swallow. It keeps unwinding; the `finally` below still
          // disposes the delimited computation.
          if (isPanic(raised)) throw raised;
          carried = raised;
          mode = "throw";
        }
        continue;
      }
      const continuation = new OneShotContinuation<B>(() => {
        around(() => { unwind(gen); });
      });
      try {
        handler.answer(request, continuation);
      } finally {
        continuation.expire();
      }
      const decision = continuation.decision;
      if (decision === undefined) {
        // §Handlers: "A handler MUST either answer a request and resume its
        // continuation exactly once, or decline to resume it."
        panic("a request was accepted and then neither answered nor declined");
      }
      // §Effect Requests, the kind table, as one exhaustive matrix and checked
      // before the decision is acted on, so that no violation can be reached by
      // ordering and no cell can be reached by omission.
      const refusal = RESUMPTION_MATRIX[request.kind][decision.mode];
      if (refusal !== undefined) panic(refusal);
      if (decision.mode === "abandon") return decision.value as B;
      carried = decision.value;
      mode = decision.mode === "resume" ? "next" : "throw";
    }
  } finally {
    // Unwinding from outside — this frame's own `yield` was abandoned, or a
    // panic is passing through — must still dispose the delimited computation.
    // A no-op once `gen` has completed, which covers every ordinary exit.
    around(() => { unwind(gen); });
  }
}

/**
 * §Propagation Is an Abort Request: "The handler for an `abort` request is the
 * compiler-installed frame handler of the nearest enclosing function with a
 * non-empty failure row. That handler MUST NOT resume; it MUST complete that
 * function with its error variant."
 */
export function resultFrame<A>(row: EffectRow): Handler<A> {
  return {
    accepts(request) {
      return request.kind === "abort";
    },
    answer(request, continuation) {
      const error = request.input;
      if (!isLocalError(error)) panic("a failure propagation carried a non-Error value");
      // Derived from §Effect Rows' definition of `E` as the failure identities
      // the function may fail with. `specification/effects.mdx` does not say
      // what a runtime must do when an abort's identity is outside the frame's
      // declared row, so this fails closed and the gap is recorded as a
      // question rather than settled here.
      //
      // The membership test is `errors.ts`'s `errorRowIncludes` and nothing
      // else. This frame used to re-derive the identity itself, from
      // `error.constructor` — the second of two independent readers of a field
      // the transport codec reconstructs from wire data, so a payload carrying
      // an own enumerable `constructor` chose which row admitted it. Both
      // readers now delegate to the one home of Error nominal identity, and
      // neither reads a property of the value.
      if (!errorRowIncludes(row.failures, error)) {
        panic("a failure propagated out of a function whose declared failures do not include it");
      }
      continuation.abandon(__vsResultFailure(error) as unknown as A);
    },
  };
}

/**
 * Drive a resumable computation to completion.
 *
 * `row` is mandatory and has no default: §Effect Rows refuses the resumable
 * convention for a function whose row is empty, and the completed-value
 * assertion below is only meaningful against a declared `E`.
 */
export function runHandled<A>(body: () => Resumable<A>, options: { readonly row: EffectRow }): A {
  const row = options?.row;
  if (row === undefined || !Array.isArray(row.failures) || !Array.isArray(row.capabilities)) {
    panic("a resumable computation was run without a declared effect row");
  }
  if (row.failures.length === 0 && row.capabilities.length === 0) {
    // §Effect Rows: "A function whose row is empty MUST NOT be emitted in the
    // resumable calling convention."
    panic("a function with an empty effect row was run in the resumable calling convention");
  }
  const previous = currentExecution;
  currentExecution = { occurrence: 0 };
  try {
    const fallible = row.failures.length > 0;
    const gen: Generator<AnyRequest, A, unknown> = fallible
      ? (handle(resultFrame<A>(row), body) as Generator<AnyRequest, A, unknown>)
      : body();
    let step = gen.next();
    while (!step.done) {
      // §Handlers: "A request that reaches the top of the program with no
      // handler that accepts its key MUST produce a panic."
      const request = step.value;
      assertLocalRequest(request);
      panic(`no handler accepted a ${request.kind} request at ${request.site}`);
    }
    const value = step.value;
    if (fallible && !isResult(value)) {
      // The assertion that makes the frame handler's cast sound: a function
      // with a non-empty failure row completes with its Result, whichever exit
      // it takes.
      panic("a function with a non-empty failure row completed without a Result");
    }
    return value;
  } finally {
    currentExecution = previous;
  }
}

/**
 * §Layer Provision Installs a Handler. A `get` whose key the layer provides is
 * answered and resumed; a `get` whose key it does not provide is forwarded
 * outward.
 */
export function capabilityHandler<B>(entries: ReadonlyMap<RequestKey, unknown>): Handler<B> {
  return {
    accepts(request) {
      return request.kind === "get" && entries.has(request.key);
    },
    answer(request, continuation) {
      continuation.resume(entries.get(request.key));
    },
  };
}

/** Compiler lowering hook for a capability read. */
export function* __vsGet<C extends CapabilityKey>(
  key: C,
  site: string,
): Generator<EffectRequest<CapabilityService<C>>, CapabilityService<C>, unknown> {
  const answer = yield makeRequest("get", key, undefined, site);
  return answer as CapabilityService<C>;
}

/**
 * Compiler lowering hook for `Layer.provide` inside a resumable computation.
 *
 * §Layer Provision Installs a Handler. Two things at once, and they answer two
 * different populations of reader:
 *
 *   - the handler answers every `get` the emitter LOWERED, with `handle`'s own
 *     forwarding giving nesting for free — an inner scope that does not provide
 *     a key forwards outward to the scope that does, which is what makes a
 *     nested `Layer.provide` compose rather than shadow;
 *   - the environment scope answers every capability read the emitter did NOT
 *     lower. Those are real and they are not a shortfall to be closed here: a
 *     read inside a property accessor cannot be a `yield` because an accessor
 *     cannot be a generator, and a read inside a host callback cannot be one
 *     because `Array.prototype.map` will not drive it. `layer.ts`'s seam block
 *     records why the shim outlives the flag.
 *
 * `Layer.provide` itself is deliberately not called. Its promise-tracking block
 * exists to decide when an ASYNC body's extent ends, and a delimited
 * computation's extent is this frame; engaging it would leave the flag unable
 * to claim the block is dead. See `__vsPromiseHookLeases`.
 */
export function* __vsProvide<A>(
  layer: unknown,
  body: () => Resumable<A>,
): Generator<AnyRequest, A, unknown> {
  const entries = __vsLayerEntries(layer);
  // Opened on first entry rather than here, so the scope inherits the
  // environment that is live when the computation actually starts — which, for
  // a `yield*`-delegated provide, is its caller's frame and not this generator
  // object's construction site.
  let scope: EnvironmentScope | undefined;
  const around: StepGuard = (step) => {
    scope ??= __vsOpenScope(entries);
    return __vsInScope(scope, step);
  };
  try {
    return (yield* handle<A, never>(capabilityHandler<never>(entries), body, around)) as A;
  } finally {
    if (scope) __vsCloseScope(scope);
  }
}

/**
 * Compiler lowering hook for `Layer.provide` where there is no enclosing
 * resumable computation to delegate into — module top level, or the body of a
 * function the emitter left in the ordinary calling convention.
 *
 * This is the delimiter AND the driver, so it is also the one place a request
 * can reach the top of the program: §Handlers requires that to panic.
 *
 * An unanswered `get` panics in `useCapability`'s exact words rather than in
 * this module's. Two reasons and both are obligations, not taste. §What This
 * Page Does Not Add requires the message to name the program's mistake — an
 * unprovided capability — and never the generator convention that carries it.
 * And the two lowerings of one program must be observationally identical: the
 * default lowering reaches `useCapability` for this mistake, so a different
 * sentence here would be a divergence that only shows up on the failing path,
 * which is the path least likely to have a corpus case pinning it.
 */
export function __vsProvideRoot<A>(layer: unknown, body: () => Resumable<A>): A {
  const previous = currentExecution;
  currentExecution = { occurrence: 0 };
  try {
    const gen = __vsProvide(layer, body);
    const step = gen.next();
    if (!step.done) {
      assertLocalRequest(step.value);
      const request = step.value;
      if (request.kind === "get") {
        const key = request.key as { name?: unknown };
        const name = typeof key?.name === "string" && key.name.length > 0 ? key.name : "<anonymous capability>";
        panic(`capability '${name}' was not provided`);
      }
      panic(`no handler accepted a ${request.kind} request at ${request.site}`);
    }
    return step.value;
  } finally {
    currentExecution = previous;
  }
}

/** Compiler lowering hook for an effect whose answer crosses a persistence boundary. */
export function* __vsPerform<A>(
  key: RequestKey,
  input: unknown,
  site: string,
): Generator<EffectRequest<A>, A, unknown> {
  const answer = yield makeRequest("perform", key, input, site);
  return answer as A;
}

/**
 * Compiler lowering hook for postfix `!`.
 *
 * §Propagation Is an Abort Request: "`e!` ... MUST evaluate to `e`'s success
 * value, or issue an `abort` request carrying `e`'s error."
 */
export function* __vsPropagate<A, E extends Error>(
  value: Result<A, E>,
  site: string,
): Generator<EffectRequest<never>, A, unknown> {
  const inspected = __vsInspectResult(value);
  if (inspected.ok) return inspected.value;
  // §Effect Requests: the key is "a nominal identity the compiler derives from
  // source", so it comes from `errors.ts`'s `errorNominalKey` — the registry or
  // the prototype chain — and never from an own field of the value, which a
  // payload controls. See `errorNominalKey` for what reading `.constructor`
  // here used to let a forged payload do to a declared failure row.
  yield makeRequest("abort", errorNominalKey(inspected.error) as RequestKey, inspected.error, site);
  panic("a failure propagation was resumed");
}
