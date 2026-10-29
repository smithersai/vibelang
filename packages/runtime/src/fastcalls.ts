// Call helpers for the JavaScript that VibeLang's text-only projector emits.
//
// The projector reads one file's text, so it cannot see the types the fork
// used to decide how a call runs. These helpers make the same decisions at run
// time:
//   - $isRun: whether a call's value runs where the call stands (L3, D24).
//   - $direct: whether a callee in another module has a plain body (D10, D65).
//   - $fast, $done, and $settle: calling an Effect function without building
//     an Effect when its body does not suspend (L2's fast-call protocol).
// L2 and L3 are language changes of decision (B), the move of code
// generation to the projector. None of these helpers changes what a call
// computes, only how fast it gets there.
import { Context, Effect, Exit } from "effect"
import { NodeInspectSymbol } from "effect/Inspectable"
import { pipeArguments } from "effect/Pipeable"
import { SingleShotGen } from "effect/Utils"
import { contA, evaluate, ExitTypeId, type FiberInternals, identifier } from "./kernel/internals.js"

// ---------------------------------------------------------------------------
// L3: the run check
// ---------------------------------------------------------------------------

const EffectTypeId = Effect.TypeId
const ServiceTypeId = Context.ServiceTypeId
// Config's type id (Config.ts:30); effect does not export it.
const ConfigTypeId = "~effect/Config"

/**
 * L3's run check: whether the value a call returned runs where the call
 * stands, `(($t = c), $isRun($t) ? (yield* $t) : $t)`. True for an Effect at
 * run time unless it is a Config, a Context key, or an Error (TaggedError
 * instances and cross-realm YieldableErrors included): the subtypes D24
 * keeps as data, told apart by keys that effect 4.1.0 puts on them, because
 * `Effect.isEffect` is true for all
 * of them. An Exit runs: `Exit.succeed(1)` and `Effect.succeed(1)` are the
 * same object at run time, so no check can keep D24's answer for it. A
 * function runs only when it is an Effect and not a Context key, which in
 * effect 4.1.0 leaves only a parameterless Effect lambda (D56). Option,
 * Result, Stream, Fiber, Layer, and Schema values are not Effects.
 */
export const $isRun = (value: unknown): boolean => {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false
  const v = value as { [identifier]?: unknown; sql?: unknown }
  // Effect 4.1.0 uses a string key, including for errors from another realm.
  // D24 SQL statements carry their query as data, including structural
  // adapters without effect/sql's nominal Statement marker.
  return EffectTypeId in v && typeof v.sql !== "string" && !("~effect/sql/Statement" in v) && !(ConfigTypeId in v) && !(ServiceTypeId in v) &&
    v[identifier] !== "YieldableError" && !(v instanceof Error)
}

// ---------------------------------------------------------------------------
// D10 across modules: the plain body of an Effect function
// ---------------------------------------------------------------------------

/**
 * D10's plain fast path without types. For a function whose body it can
 * prove pure, the projector emits the plain function `f$direct` and the
 * Effect function `f`, and writes `f[$direct] = f$direct`. A caller in
 * another module reads the property at the call, so it needs no type from
 * f's module. Contract: `f[$direct](...args)` returns the value that running
 * `f(...args)` succeeds with. When the property is missing, the caller makes
 * the slow call and gets the same value; that happens for a function another
 * compiler wrote, and for one whose module an import cycle has not evaluated
 * yet. The symbol is registered (`Symbol.for`), so two copies of the runtime
 * agree on it.
 */
export const $direct: unique symbol = Symbol.for("vibelang/direct")

// ---------------------------------------------------------------------------
// L2: the fast-call protocol
// ---------------------------------------------------------------------------
//
// A same-file call that runs, `f(x)` in an Effect body, calls f's fast entry
// and runs what it returns only when that is an Effect, as any other call:
//
//   (($t = f$fast(x)), $isRun($t) ? (yield* $t) : $t)
//
// The entry runs f's body eagerly on the caller's JavaScript stack and
// returns the body's value when it finishes without needing the fiber. It
// returns an Effect otherwise: one that resumes the body after the Effect it
// yielded, or one that fails as the body did. The call site then has the
// slow call's result, `yield* f(x)`. The projector currently writes this
// entry for every function it cannot prove pure:
//
//   const f$fast = $fast(f$body)
//
// A planned per-function entry avoids counting eager depth for functions
// outside a same-file call cycle:
//
//   function f$fast(a, b) { const it = f$body(a, b), s = it.next(); return s.done ? $done(s.value) : $settle(it, s) }
//
// Only such a cycle can nest eager runs without limit: a call of another
// file's function, of a lambda, or of a function value starts its body on
// the fiber.

type ErrorOf<Eff> = [Eff] extends [never] ? never : [Eff] extends [Effect.Effect<infer _A, infer E, infer _R>] ? E : never
type ServicesOf<Eff> = [Eff] extends [never] ? never : [Eff] extends [Effect.Effect<infer _A, infer _E, infer R>] ? R : never

/** What a fast entry returns: the body's value, or an Effect that produces it. */
export type Fast<A, Eff> = A | Effect.Effect<A, ErrorOf<Eff>, ServicesOf<Eff>>

/**
 * The value a fast entry returns for a body that finished: the value itself,
 * or `Exit.succeed(value)` when the value is one that `$isRun` would run, so
 * that the call site's run check gives the value back instead of running it.
 */
export const $done = <A>(value: A): A | Effect.Effect<A> => ($isRun(value) ? Exit.succeed(value) : value)

/** A defect: generated code ran one suspended fast call twice, which would resume a body that already moved on. */
class FastCallRanTwice extends Error {
  readonly _tag = "FastCallRanTwice"
  constructor() {
    super("A suspended fast call ran twice; it resumes its body once")
  }
}

// Pending.step once the fiber has run the Pending.
const ran: unique symbol = Symbol("vibelang/fast/ran")

/**
 * A body that suspended: a one-shot Effect that runs the Effect the body
 * yielded and then resumes the same body on the fiber. It is also the
 * body's frame on the fiber stack, the frame Effect.gen pushes (its Iterator
 * primitive, internal/effect.ts:1413), so handlers capture and resume it like
 * any generator frame, and interruption and cleanup see an ordinary
 * generator. A class of its own costs less than Effect.gen's suspend and
 * Iterator pair: the suspending fast call is faster than the slow call
 * (README).
 */
class Pending {
  constructor(
    private readonly body: Iterator<unknown, unknown, unknown>,
    // The Effect the body yielded, until the fiber runs it.
    private step: unknown
  ) {}

  [evaluate](fiber: FiberInternals): unknown {
    const step = this.step
    if (step === ran) return Exit.die(new FastCallRanTwice())
    this.step = ran
    fiber._stack.push(this)
    return step
  }

  // The fiber's own generator step: Exits resolve in place, anything else
  // waits for the fiber with this frame on its stack.
  [contA](value: unknown, fiber: FiberInternals): unknown {
    const body = this.body
    while (true) {
      const state = body.next(value)
      if (state.done) return Exit.succeed(state.value)
      const step = state.value as any
      if (step[ExitTypeId] === undefined) {
        fiber._stack.push(this)
        return step
      }
      if (step._tag === "Failure") return step
      value = step.value
    }
  }
}

// The rest of the Effect protocol (internal/core.ts:67-80), so a Pending is
// an Effect to $isRun, yield*, pipe, and inspection.
Object.assign(Pending.prototype, {
  [EffectTypeId]: (Effect.void as any)[EffectTypeId],
  [identifier]: "vibelang/FastCall",
  [Symbol.iterator](this: Pending) {
    return new SingleShotGen(this)
  },
  pipe(this: Pending) {
    return pipeArguments(this, arguments)
  },
  toJSON() {
    return { _id: "Effect", op: "vibelang/FastCall" }
  },
  [NodeInspectSymbol](this: { toJSON(): unknown }) {
    return this.toJSON()
  }
})

/**
 * Finishes a fast entry whose body's first step did not finish it, from
 * that step `s`, eagerly: a yielded Exit resolves in place, as the fiber's
 * own generator step does. Returns `$done` of the body's value; or, when the
 * body yields an Effect that needs the fiber, an Effect that runs it and
 * resumes the body there; or the failure Exit the body yielded. A defect the
 * body throws here comes back as `Exit.die`. All of these surface at the
 * call site's `yield*`, inside the caller's regions, as the slow call's do.
 */
export function $settle<Eff extends Effect.Effect<any, any, any>, A>(
  it: Iterator<Eff, A, any>,
  s: IteratorResult<Eff, A>
): Fast<A, Eff> {
  try {
    while (true) {
      if (s.done) return $done(s.value)
      const step = s.value as any
      if (step[ExitTypeId] === undefined) return new Pending(it, step) as any
      if (step._tag === "Failure") return step
      s = it.next(step.value)
    }
  } catch (defect) {
    return Exit.die(defect)
  }
}

// Past this many nested eager runs of $fast entries, an entry makes the slow
// call instead, which runs the body on the fiber with its frames on the heap
// (D10: functions that can pause recurse without limit). Each eager level
// holds three JavaScript frames (the entry, the generator's resume, and the
// body), but frame size depends on the body's live locals. Node 26.10's
// default stack overflows at 3,085 levels with no locals, 888 with 80,
// 485 with 200, and 272 with 400 (Bun 1.4.1: 9,384 with no locals and
// 4,143 with 80). With a 6,000-frame plain base stack, 80 locals overflow
// Node at 297 levels. A cap of 100 leaves room in these measured cases;
// it is not a per-body stack guarantee: enough live locals, a deeper base
// stack, or plain recursion inside a body can still overflow. Never retry
// after a RangeError: the body may already have run side effects. A deeper
// recursion costs the same with any bound, because every level then suspends.
const maxEagerDepth = 100
// Shared by generated plain entries and $fast. A plain entry uses 1/16
// of a generator entry's budget (one small JS frame instead of a generator,
// iterator and adapter). Native calls forward remaining budget privately,
// publishing it at opaque boundaries; heap entry reserves the full budget.
// Publications and reservations restore their incoming state in finally;
// no reservation survives suspension or a fiber switch.
type EagerFunction = (...args: Array<any>) => any
const heapFactories = new WeakMap<EagerFunction, EagerFunction>()
const eagerEntries = new WeakMap<EagerFunction, { stack: EagerFunction; recur?: EagerFunction }>()

// Keep generated metadata outside function objects: freezing a public
// Effect or its direct entry must not disable deep recursion.
export const $eager = {
  depth: 0,
  limit: maxEagerDepth * 16,
  call<A>(remaining: number, body: () => A): A {
    const previous = $eager.depth
    $eager.depth = $eager.limit - remaining
    try {
      return body()
    } finally {
      $eager.depth = previous
    }
  },
  getHeap(fn: EagerFunction): EagerFunction | undefined {
    return heapFactories.get(fn)
  },
  setHeap(fn: EagerFunction, factory: EagerFunction): EagerFunction {
    heapFactories.set(fn, factory)
    return factory
  },
  register(direct: EagerFunction, stack: EagerFunction, recur?: EagerFunction): void {
    eagerEntries.set(direct, { stack, recur })
  },
  recur(direct: EagerFunction): EagerFunction | undefined {
    return eagerEntries.get(direct)?.recur
  },
  stack(direct: EagerFunction): EagerFunction {
    return eagerEntries.get(direct)?.stack ?? direct
  }
}

/**
 * The fast entry that bounds eager nesting: `const f$fast = $fast(f$body)`.
 * The projector currently uses it for every function it cannot prove pure.
 * It returns what the planned per-function entry returns (see `$settle`),
 * and runs the body eagerly while fewer than 100 entries run beneath it
 * on the JavaScript stack. Past that, it returns the slow call's Effect, which
 * starts the body on the fiber. On Node 26.10, 200 and 400 live locals
 * overflow at 485 and 272 eager levels; 80 locals on a 6,000-frame plain
 * base stack overflow at 297. The cap covers these cases, but a body with
 * enough live locals or a deeper base stack can still overflow; it cannot
 * bound plain recursion within a body. A RangeError becomes a Die, with
 * no retry because the body may already have run side effects. It also
 * catches a throw in the body's first step and in binding its parameters,
 * which the planned per-function entry leaves to the caller's body.
 */
export function $fast<Args extends Array<any>, Eff extends Effect.Effect<any, any, any>, A>(
  body: (...args: Args) => Generator<Eff, A, any>
): (...args: Args) => Fast<A, Eff> {
  const slow = Effect.fnUntraced(body as (...args: Args) => Generator<Eff, A, any>)
  return function(this: unknown, ...args: Args): Fast<A, Eff> {
    if ($eager.depth >= $eager.limit) return slow.apply(this, args) as any
    $eager.depth += 16
    try {
      const it = body.apply(this, args)
      return $settle(it, it.next())
    } catch (defect) {
      return Exit.die(defect)
    } finally {
      $eager.depth -= 16
    }
  }
}
