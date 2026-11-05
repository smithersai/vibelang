import { Cause, Context, Deferred, Effect, Exit, Fiber, Scope } from "effect"
import * as Runtime from "vibelang-runtime"
import { catchExpected } from "vibelang-runtime/kernel"

type Reason = { tag: "Fail" | "Die" | "Interrupt"; value: number }
type Release = { label: number; reason: "success" | "Fail" | "Die"; value: number }
export type Program =
  | { op: "success"; value: number }
  | { op: "cause"; reasons: Reason[] }
  | { op: "read" | "interrupt" }
  | { op: "yield" | "mask" | "restore" | "interruptible"; body: Program }
  | { op: "then"; body: Program; next: Program }
  | { op: "catch"; body: Program; next: Program; kernel: boolean }
  | { op: "finally"; body: Program; cleanup: Program; label: number }
  | { op: "provide"; body: Program; value: number }
  | { op: "region"; body: Program; releases: Release[] }

class Value extends Context.Service<Value, number>()("property-programs/Value") {}
type Run = Effect.Effect<number, number, Value>
type Trace = unknown[]
type Restore = (program: Run) => Run

// Fiber's public type omits the machine mask. Fail clearly if this trace probe stops being available.
const maskState = Effect.withFiber(fiber => Effect.sync(() => {
  const value = (fiber as typeof fiber & { interruptible: boolean }).interruptible
  if (typeof value !== "boolean") throw new Error("property trace: fiber interruptibility is unavailable")
  return value
}))

// Four levels, at most 19 AST/release nodes. Small payload domains exercise duplicate reasons.
export function programArbitrary(fc: typeof import("fast-check")) {
  const value = fc.integer({ min: 0, max: 3 })
  const reason = fc.record({ tag: fc.constantFrom("Fail", "Die", "Interrupt"), value })
  const leaf = fc.oneof(
    { withCrossShrink: true },
    fc.record({ op: fc.constant("success"), value }),
    fc.record({ op: fc.constant("cause"), reasons: fc.array(reason, { minLength: 1, maxLength: 3 }) }),
    fc.record({ op: fc.constantFrom("read", "interrupt") })
  )
  const release = fc.record({ label: value, reason: fc.constantFrom("success", "Fail", "Die"), value })
  const branch = (child: any) => fc.oneof(
    { withCrossShrink: true },
    leaf,
    fc.record({ op: fc.constantFrom("yield", "mask", "restore", "interruptible"), body: child }),
    fc.record({ op: fc.constant("then"), body: child, next: child }),
    fc.record({ op: fc.constant("catch"), body: child, next: child, kernel: fc.boolean() }),
    fc.record({ op: fc.constant("finally"), body: child, cleanup: child, label: value }),
    fc.record({ op: fc.constant("provide"), body: child, value }),
    fc.record({ op: fc.constant("region"), body: child, releases: fc.array(release, { maxLength: 2 }) })
  )
  return fc.letrec(tie => ({ leaf, one: branch(tie("leaf")), two: branch(tie("one")), program: branch(tie("two")) }))
    .program as import("fast-check").Arbitrary<Program>
}

function runtime(program: Program, trace: Trace): Run {
  const visit = (p: Program): Run => Effect.suspend(() => {
    switch (p.op) {
      case "success": return Effect.succeed(p.value)
      case "read": return Effect.tap(Value, value => Effect.sync(() => { trace.push(["read", value]) }))
      case "interrupt": return Effect.interrupt
      case "cause": return Effect.failCause(Cause.fromReasons(p.reasons.map(r =>
        r.tag === "Fail" ? Cause.makeFailReason(r.value) : r.tag === "Die" ? Cause.makeDieReason(r.value) : Cause.makeInterruptReason(900000000 + r.value))))
      case "then": return Effect.andThen(visit(p.body), visit(p.next))
      case "catch": return (p.kernel ? catchExpected : Runtime.$catch)(visit(p.body), error => Effect.andThen(
        Effect.sync(() => { trace.push(["catch", error]) }), visit(p.next)))
      case "yield": return Effect.andThen(Effect.yieldNow, visit(p.body))
      case "mask": return Runtime.uninterruptible(visit(p.body))
      case "restore": return Runtime.restore(visit(p.body))
      case "interruptible": return Runtime.interruptible(visit(p.body))
      case "provide": return Effect.provide(visit(p.body), Runtime.$provideService(Value, "Value", p.value))
      case "finally": return Runtime.$finally(visit(p.body), Effect.gen(function*() {
        trace.push(["finally", p.label, yield* Value, yield* maskState])
        return yield* visit(p.cleanup)
      }))
      case "region": return Runtime.$region(scope => Effect.gen(function*() {
        const context = yield* Effect.context<Value>()
        // Scope types forbid typed cleanup failures; Chapter 17 requires testing their runtime combination.
        for (const r of p.releases) yield* Scope.addFinalizer(scope, Effect.provideContext(Effect.gen(function*() {
          trace.push(["release", r.label, yield* Value, yield* maskState])
          if (r.reason === "Fail") return yield* Effect.fail(r.value)
          if (r.reason === "Die") return yield* Effect.die(r.value)
        }), context) as unknown as Effect.Effect<void>)
        return yield* visit(p.body)
      }))
    }
  })
  return visit(program)
}

// Independent translation to the Effect forms named in Chapters 17/20; no runtime predicates.
function reference(p: Program, trace: Trace, restore: Restore = p => p): Run {
  return Effect.suspend(() => {
    switch (p.op) {
      case "success": return Effect.succeed(p.value)
      case "read": return Effect.map(Value, value => { trace.push(["read", value]); return value })
      case "interrupt": return Effect.interrupt
      case "cause": {
        const reasons = p.reasons.map(r => {
          switch (r.tag) {
            case "Fail": return Cause.makeFailReason(r.value)
            case "Die": return Cause.makeDieReason(r.value)
            case "Interrupt": return Cause.makeInterruptReason(900000000 + r.value)
          }
        })
        return Effect.failCause(Cause.fromReasons(reasons))
      }
      case "then": return Effect.flatMap(reference(p.body, trace, restore), () => reference(p.next, trace, restore))
      case "catch": return Effect.catch(reference(p.body, trace, restore), error => {
        trace.push(["catch", error])
        return reference(p.next, trace, restore)
      })
      case "yield": return Effect.flatMap(Effect.yieldNow, () => reference(p.body, trace, restore))
      case "mask": return Effect.uninterruptibleMask(previous => reference(p.body, trace, previous))
      case "restore": return restore(reference(p.body, trace, restore))
      case "interruptible": return Effect.interruptible(reference(p.body, trace, restore))
      case "provide": return Effect.provideService(reference(p.body, trace, restore), Value, p.value)
      case "finally": return Effect.onExit(reference(p.body, trace, restore), () => Effect.gen(function*() {
        const value = yield* Value
        const masked = yield* maskState
        trace.push(["finally", p.label, value, masked])
        yield* reference(p.cleanup, trace, restore)
      }))
      case "region": return Effect.scoped(Effect.gen(function*() {
        for (const r of p.releases) yield* Effect.addFinalizer(() => Effect.gen(function*() {
          const value = yield* Value
          const masked = yield* maskState
          trace.push(["release", r.label, value, masked])
          yield* r.reason === "success" ? Effect.void : r.reason === "Fail" ? Effect.fail(r.value) : Effect.die(r.value)
        }) as unknown as Effect.Effect<void, never, Value>)
        return yield* reference(p.body, trace, restore)
      }))
    }
  })
}

function observation(exit: Exit.Exit<unknown, unknown>, trace: Trace) {
  const fibers = new Map<number, number>()
  const identity = (id: number) => {
    if (id >= 900000000 && id <= 900000003 || id === 900000010) return id // Explicit, stable AST/controller identities.
    if (!fibers.has(id)) fibers.set(id, fibers.size)
    return `fiber-${fibers.get(id)}`
  }
  return {
    exit: Exit.isSuccess(exit) ? { tag: "Success", value: exit.value } : {
      tag: "Failure", reasons: exit.cause.reasons.map(r => {
        switch (r._tag) {
          case "Fail": return ["Fail", r.error]
          case "Die": return ["Die", r.defect]
          case "Interrupt": return ["Interrupt", identity(r.fiberId)]
        }
      })
    }, trace
  }
}

export async function runProgram(program: Program, engine: "runtime" | "effect") {
  const trace: Trace = []
  const effect = engine === "runtime" ? runtime(program, trace) : reference(program, trace)
  return observation(await Effect.runPromiseExit(Effect.provideService(effect, Value, 0)), trace)
}

export async function runInterrupted(input: { body: Program; masked: boolean }, engine: "runtime" | "effect") {
  const trace: Trace = []
  const exit = await Effect.runPromise(Effect.gen(function*() {
    const entered = yield* Deferred.make<void>()
    const gate = yield* Deferred.make<void>()
    const body = (previous?: Restore) => Effect.gen(function*() {
      yield* Deferred.succeed(entered, undefined)
      yield* Deferred.await(gate)
      trace.push("past-gate")
      return yield* (engine === "runtime" ? runtime(input.body, trace) : reference(input.body, trace, previous))
    })
    const masked = input.masked ? engine === "runtime" ? Runtime.uninterruptible(body()) : Effect.uninterruptibleMask(previous => body(previous)) : body()
    const cleanup = Effect.andThen(Effect.yieldNow, Effect.sync(() => { trace.push("interrupted-finalizer") }))
    const work = engine === "runtime" ? Runtime.$finally(masked, cleanup) : Effect.ensuring(masked, cleanup)
    const child = yield* Effect.forkChild(Effect.provideService(work, Value, 0))
    yield* Deferred.await(entered)
    child.interruptUnsafe(900000010)
    yield* Deferred.succeed(gate, undefined)
    return yield* Fiber.await(child)
  }).pipe(Effect.timeout("10 seconds")))
  return observation(exit, trace)
}
