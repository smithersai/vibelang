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
// Runs before each AST node; the interruption property uses it to stop the program at a generated step.
type Step = Effect.Effect<void>

// Interrupt reason values index these ids. The negative ids are the input of the
// filed negative-interruptor defect; observation() keeps every one stable.
export const interruptIds = [900000000, 900000001, 900000002, 900000003, -1, -900000000] as const
const interruptId = (value: number) => interruptIds[value]
const controllerId = 900000010

// Fiber's public type omits the machine mask. Fail clearly if this trace probe stops being available.
const maskState = Effect.withFiber(fiber => Effect.sync(() => {
  const value = (fiber as typeof fiber & { interruptible: boolean }).interruptible
  if (typeof value !== "boolean") throw new Error("property trace: fiber interruptibility is unavailable")
  return value
}))

// Four levels, at most 19 AST/release nodes. Small payload domains exercise duplicate reasons.
export function programArbitrary(fc: typeof import("fast-check")) {
  const value = fc.integer({ min: 0, max: 3 })
  const reason = fc.oneof(
    fc.record({ tag: fc.constantFrom("Fail", "Die"), value }),
    fc.record({ tag: fc.constant("Interrupt"), value: fc.integer({ min: 0, max: interruptIds.length - 1 }) }))
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

function runtime(program: Program, trace: Trace, step?: Step): Run {
  const visit = (p: Program): Run => step ? Effect.andThen(step, node(p)) : node(p)
  const node = (p: Program): Run => Effect.suspend(() => {
    switch (p.op) {
      case "success": return Effect.succeed(p.value)
      case "read": return Effect.tap(Value, value => Effect.sync(() => { trace.push(["read", value]) }))
      case "interrupt": return Effect.interrupt
      case "cause": return Effect.failCause(Cause.fromReasons(p.reasons.map(r =>
        r.tag === "Fail" ? Cause.makeFailReason(r.value) : r.tag === "Die" ? Cause.makeDieReason(r.value) : Cause.makeInterruptReason(interruptId(r.value)))))
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
function reference(p: Program, trace: Trace, restore: Restore = p => p, step?: Step): Run {
  const node = Effect.suspend((): Run => {
    switch (p.op) {
      case "success": return Effect.succeed(p.value)
      case "read": return Effect.map(Value, value => { trace.push(["read", value]); return value })
      case "interrupt": return Effect.interrupt
      case "cause": {
        const reasons = p.reasons.map(r => {
          switch (r.tag) {
            case "Fail": return Cause.makeFailReason(r.value)
            case "Die": return Cause.makeDieReason(r.value)
            case "Interrupt": return Cause.makeInterruptReason(interruptId(r.value))
          }
        })
        return Effect.failCause(Cause.fromReasons(reasons))
      }
      case "then": return Effect.flatMap(reference(p.body, trace, restore, step), () => reference(p.next, trace, restore, step))
      case "catch": return Effect.catch(reference(p.body, trace, restore, step), error => {
        trace.push(["catch", error])
        return reference(p.next, trace, restore, step)
      })
      case "yield": return Effect.flatMap(Effect.yieldNow, () => reference(p.body, trace, restore, step))
      case "mask": return Effect.uninterruptibleMask(previous => reference(p.body, trace, previous, step))
      case "restore": return restore(reference(p.body, trace, restore, step))
      case "interruptible": return Effect.interruptible(reference(p.body, trace, restore, step))
      case "provide": return Effect.provideService(reference(p.body, trace, restore, step), Value, p.value)
      case "finally": return Effect.onExit(reference(p.body, trace, restore, step), () => Effect.gen(function*() {
        const value = yield* Value
        const masked = yield* maskState
        trace.push(["finally", p.label, value, masked])
        yield* reference(p.cleanup, trace, restore, step)
      }))
      case "region": return Effect.scoped(Effect.gen(function*() {
        for (const r of p.releases) yield* Effect.addFinalizer(() => Effect.gen(function*() {
          const value = yield* Value
          const masked = yield* maskState
          trace.push(["release", r.label, value, masked])
          yield* r.reason === "success" ? Effect.void : r.reason === "Fail" ? Effect.fail(r.value) : Effect.die(r.value)
        }) as unknown as Effect.Effect<void, never, Value>)
        return yield* reference(p.body, trace, restore, step)
      }))
    }
  })
  return step ? Effect.flatMap(step, () => node) : node
}

function observation(exit: Exit.Exit<unknown, unknown>, trace: Trace) {
  const fibers = new Map<number, number>()
  const identity = (id: number) => {
    if ((interruptIds as readonly number[]).includes(id) || id === controllerId) return id // Explicit, stable AST/controller identities.
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

export type Interrupted = { body: Program; masked: boolean; point?: number }

// point 0 (or absent) interrupts the child at a gate before the body; a masked
// child carries the interrupt pending through the whole body. point n > 0 stops
// the body before its nth AST node, so an unmasked interrupt lands inside the
// running program, and inside any mask, restore or finalizer active there.
export async function runInterrupted(input: Interrupted, engine: "runtime" | "effect") {
  const trace: Trace = []
  const point = input.point ?? 0
  const exit = await Effect.runPromise(Effect.gen(function*() {
    const entered = yield* Deferred.make<void>()
    const gate = yield* Deferred.make<void>()
    const stop = Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(gate))
    let visited = 0
    const step: Step | undefined = point === 0 ? undefined : Effect.suspend(() => {
      if (++visited !== point) return Effect.void
      trace.push(["step", point])
      return stop
    })
    const body = (previous?: Restore) => Effect.gen(function*() {
      if (point === 0) {
        yield* stop
        trace.push("past-gate")
      }
      return yield* (engine === "runtime" ? runtime(input.body, trace, step) : reference(input.body, trace, previous, step))
    })
    const masked = input.masked ? engine === "runtime" ? Runtime.uninterruptible(body()) : Effect.uninterruptibleMask(previous => body(previous)) : body()
    const cleanup = Effect.andThen(Effect.yieldNow, Effect.sync(() => { trace.push("interrupted-finalizer") }))
    const work = engine === "runtime" ? Runtime.$finally(masked, cleanup) : Effect.ensuring(masked, cleanup)
    const child = yield* Effect.forkChild(Effect.provideService(work, Value, 0))
    // A program with fewer than point nodes finishes without stopping; the interrupt then lands on a finished fiber.
    yield* Effect.raceFirst(Deferred.await(entered), Effect.asVoid(Fiber.await(child)))
    child.interruptUnsafe(controllerId)
    yield* Deferred.succeed(gate, undefined)
    return yield* Fiber.await(child)
  }).pipe(Effect.timeout("10 seconds")))
  return observation(exit, trace)
}

// Masked inputs keep the pre-body gate as well as inner points; unmasked inputs
// always stop inside the program, since an unmasked gate before it ends the
// child before its first node.
export function interruptedArbitrary(fc: typeof import("fast-check")) {
  const body = programArbitrary(fc)
  return fc.oneof(
    fc.record({ body, masked: fc.constant(true), point: fc.integer({ min: 0, max: 12 }) }),
    fc.record({ body, masked: fc.constant(false), point: fc.integer({ min: 1, max: 12 }) })
  ) as import("fast-check").Arbitrary<Interrupted>
}
