// Q9 prototype (disposable): one-shot shift/reset on an Effect 4.1.0 fiber by
// popping frames off FiberImpl._stack up to a prompt frame and re-pushing them.
// Uses internal property names; not a public API.
import { Context, Effect, Exit } from "effect"

const contA = "~effect/Effect/successCont"
const contE = "~effect/Effect/failureCont"
const PROMPT = Symbol("prompt")

type FiberInternals = {
  _stack: Array<any>
  context: Context.Context<never>
  interruptible: boolean
  setContext(ctx: Context.Context<never>): void
}

// A prompt frame restores the context/interruptibility it was created with when a
// value or failure passes through it, then forwards unchanged.
const makePrompt = (fiber: FiberInternals) => {
  const ctx = fiber.context
  const interruptible = fiber.interruptible
  const restore = (f: FiberInternals) => {
    f.setContext(ctx)
    f.interruptible = interruptible
  }
  return {
    [PROMPT]: true,
    [contA](value: unknown, f: FiberInternals) {
      restore(f)
      return Effect.succeed(value)
    },
    [contE](cause: any, f: FiberInternals) {
      restore(f)
      return Effect.failCause(cause)
    }
  }
}

const reset = <A, E, R>(body: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.withFiber((fiber) => {
    const f = fiber as unknown as FiberInternals
    f._stack.push(makePrompt(f))
    return body
  })

const shift = <A, B, E, R>(
  body: (k: (a: A) => Effect.Effect<B>) => Effect.Effect<B, E, R>
): Effect.Effect<A, E, R> =>
  Effect.withFiber((fiber) => {
    const f = fiber as unknown as FiberInternals
    const frames: Array<any> = []
    let prompt: any
    for (;;) {
      const op = f._stack.pop()
      if (op === undefined) return Effect.die("shift without reset")
      if (op[PROMPT]) {
        prompt = op
        break
      }
      frames.push(op)
    }
    const innerCtx = f.context
    const innerInterruptible = f.interruptible
    let used = false
    const k = (a: A): Effect.Effect<B> =>
      Effect.withFiber((caller) => {
        const c = caller as unknown as FiberInternals
        if (c !== f) return Effect.die("prototype: k must run on the capturing fiber")
        if (used) return Effect.die("one-shot continuation resumed twice")
        used = true
        c._stack.push(makePrompt(c)) // k(a) is delimited: returns to its caller
        for (let i = frames.length - 1; i >= 0; i--) c._stack.push(frames[i])
        c.setContext(innerCtx)
        c.interruptible = innerInterruptible
        return Effect.succeed(a) as any
      })
    // run the shift body at the reset level (its context), inside a fresh prompt
    prompt[contA](undefined, f) // restore reset-level context without consuming a value
    f._stack.push(makePrompt(f))
    return body(k) as any
  })

const Tag = Context.Reference<string>("q9/Tag", { defaultValue: () => "reset-level" })
const show = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit) ? `Success(${JSON.stringify(exit.value)})` : `Failure(${String(exit.cause)})`

const cases: Record<string, Effect.Effect<unknown, unknown>> = {
  "basic: reset(2 * shift(k => k(10) + 1))": reset(Effect.gen(function*() {
    const x = yield* shift<number, number, never, never>((k) => Effect.map(k(10), (y) => y + 1))
    return x * 2
  })),
  "abort: shift body ignores k": reset(Effect.gen(function*() {
    yield* shift<number, string, never, never>(() => Effect.succeed("aborted"))
    return "unreachable"
  })),
  "one-shot: k called twice": reset(Effect.gen(function*() {
    const x = yield* shift<number, number, never, never>((k) => Effect.flatMap(k(1), (a) => Effect.map(k(2), (b) => a + b)))
    return x
  })),
  "context: provideService inside reset": reset(Effect.provideService(Tag, "inner")(Effect.gen(function*() {
    const seen: Array<string> = []
    yield* shift<void, Array<string>, never, never>((k) =>
      Effect.gen(function*() {
        seen.push(`shift body sees ${yield* Tag}`)
        yield* k(undefined)
        seen.push(`after k sees ${yield* Tag}`)
        return seen
      })
    )
    seen.push(`continuation sees ${yield* Tag}`)
    return seen
  }))),
  "failure inside continuation caught by a captured catch frame": reset(
    Effect.catch(
      Effect.gen(function*() {
        yield* shift<number, string, never, never>((k) => k(1))
        return yield* Effect.fail("e")
      }),
      (e) => Effect.succeed(`caught ${e}`)
    )
  )
}

for (const [name, eff] of Object.entries(cases)) {
  console.log(name.padEnd(62), show(await Effect.runPromiseExit(eff)))
}

// discarded continuation: are finalizers inside the captured frames run?
{
  const log: Array<string> = []
  const exit = await Effect.runPromiseExit(reset(
    Effect.gen(function*() {
      yield* shift<void, string, never, never>(() => Effect.succeed("discarded k"))
      return "unreachable"
    }).pipe(Effect.ensuring(Effect.sync(() => log.push("ensuring finalizer ran"))))
  ))
  console.log("discarded continuation with ensuring inside reset".padEnd(62), show(exit), `finalizer log=[${log.join(",")}]`)
}
