// The projector's run-time call helpers: $isRun (L3), $direct (D10 across
// modules), and the fast-call protocol $done/$settle/$fast (L2). Every
// fast-call test runs the same body three ways and compares them: the slow
// call it replaces, `yield* Effect.fnUntraced(body)(x)`, the per-function
// entry planned for functions outside call cycles, and the $fast entry the
// projector currently writes for every function it cannot prove pure.
import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import { inspect } from "node:util"
import { Cause, Config, Context, Data, Deferred, Fiber, Option, Stream } from "effect"
import {
  $catch, $catchCause, $control, $direct, $done, $fast, $finally, $isRun, $service, $settle, $tailResume,
  Effect, Exit, handle, resume, TaggedError
} from "vibelang-runtime"

type Body<A> = Generator<any, A, any>
type Entry<Args extends Array<any>, A> = (...args: Args) => unknown

/** `function f$fast(a) { const it = f$body(a), s = it.next(); return s.done ? $done(s.value) : $settle(it, s) }` */
const perFunction = <Args extends Array<any>, A>(body: (...args: Args) => Body<A>): Entry<Args, A> =>
  (...args) => {
    const it = body(...args), s = it.next()
    return s.done ? $done(s.value) : $settle(it, s)
  }

/** The call site the projector emits: `(($t = f$fast(x)), $isRun($t) ? (yield* $t) : $t)`. */
function* site<A>(value: unknown): Generator<any, A, any> {
  let $t
  return (($t = value), $isRun($t) ? yield* ($t as Effect.Effect<A>) : $t) as A
}

const shapes = ["slow", "per-function", "$fast"] as const
type Shape = typeof shapes[number]

/** A program that calls body(...args) where it stands, the given way. */
const call = <Args extends Array<any>, A>(shape: Shape, body: (...args: Args) => Body<A>, ...args: Args) =>
  Effect.gen(function* () {
    if (shape === "slow") return (yield* Effect.fnUntraced(body)(...args)) as A
    const entry = shape === "$fast" ? $fast(body) : perFunction(body)
    return yield* site<A>(entry(...args))
  })

const exits = async <Args extends Array<any>, A>(body: (...args: Args) => Body<A>, ...args: Args) =>
  Promise.all(shapes.map((shape) => Effect.runPromiseExit(call(shape, body, ...args))))

describe("$isRun", () => {
  class NotFound extends Data.TaggedError("NotFound")<{}> {}
  class Gone extends TaggedError("Gone")<{}> {}
  class Db extends Context.Service<Db, { readonly q: number }>()("fast-test/Db") {}
  interface Users { readonly all: () => Effect.Effect<Array<string>> }
  class Users extends $service<Users>("fast-test/Users") {}

  // The D24 probe of the text-only study: one value per call it types, with
  // L3's answer, which runs every Effect but Config, keys, and errors.
  const anyEffect: any = Effect.succeed(1)
  const unknownData: unknown = 42
  const maybe = (some: boolean): Effect.Effect<number> | undefined => (some ? Effect.succeed(1) : undefined)
  const mixed = (effect: boolean): boolean | Effect.Effect<boolean> => (effect ? Effect.succeed(true) : true)
  const probe: Array<[string, unknown, boolean]> = [
    ["Effect", Effect.sync(() => 1), true],
    ["Config", Config.String("FAST_TEST_UNSET"), false],
    ["structural SQL statement", Object.assign(Effect.suspend(() => Effect.void), { sql: "SELECT 1" }), false],
    ["nominal SQL statement", Object.assign(Effect.suspend(() => Effect.void), { "~effect/sql/Statement": "~effect/sql/Statement" }), false],
    ["Exit", Exit.succeed(1), true],
    ["TaggedError instance", new NotFound(), false],
    ["Context key", Db, false],
    ["Option", Option.some(1), false],
    ["Stream", Stream.make(1), false],
    ["any holding an Effect", anyEffect, true],
    ["unknown holding data", unknownData, false],
    ["Effect | undefined holding the Effect", maybe(true), true],
    ["Effect | undefined holding undefined", maybe(false), false],
    ["boolean | Effect holding the boolean", mixed(false), false],
    ["boolean | Effect holding the Effect", mixed(true), true]
  ]

  for (const [name, value, runs] of probe) {
    test(`${name} ${runs ? "runs" : "is data"}`, () => {
      expect($isRun(value)).toBe(runs)
    })
  }

  test("VibeLang's own keys, other errors, and Effects that fail are told apart", () => {
    expect($isRun(Users)).toBe(false)
    expect($isRun(new Gone())).toBe(false)
    expect($isRun(new Cause.NoSuchElementError())).toBe(false)
    expect($isRun(Context.Reference("fast-test/Ref", { defaultValue: () => 1 }))).toBe(false)
    expect($isRun(Effect.fail("e"))).toBe(true)
    expect($isRun(Effect.never)).toBe(true)
    expect($isRun(Config.succeed(1))).toBe(false)
  })

  test("cross-realm and structural YieldableErrors remain data at the call site", async () => {
    const crossRealm = runInNewContext('new Error("other realm")')
    const proto = Object.getPrototypeOf(new NotFound())
    for (const value of [crossRealm, {}]) {
      // Copy Effect 4.1.0's actual YieldableError protocol without its Error
      // prototype; the vm Error also belongs to another realm's Error class.
      Object.assign(value, {
        [Effect.TypeId]: proto[Effect.TypeId],
        "~effect/Effect/identifier": proto["~effect/Effect/identifier"]
      })
      expect(value instanceof Error).toBe(false)
      expect(Effect.isEffect(value)).toBe(true)
      expect(value["~effect/Effect/identifier"]).toBe("YieldableError")
      expect($isRun(value)).toBe(false)
      expect($done(value)).toBe(value)
      expect(await Effect.runPromise(Effect.gen(function* () { return yield* site(value) }))).toBe(value)
      for (const shape of shapes) {
        expect(await Effect.runPromise(call(shape, function* () { return value }))).toBe(value)
      }
    }
  })

  test("functions run only when they are Effects that are not keys", () => {
    // D56's parameterless lambda: one value that is a program and an Effect function.
    const program = Effect.sync(() => 1)
    const dual = Object.assign(Object.setPrototypeOf(() => program, Object.getPrototypeOf(program)), program)
    expect(Effect.isEffect(dual)).toBe(true)
    expect($isRun(dual)).toBe(true)
    expect($isRun(() => program)).toBe(false)
    expect($isRun(Effect.fnUntraced(function* () {}))).toBe(false)
  })

  test("primitives, null, and plain objects are data", () => {
    for (const value of [undefined, null, 0, "s", true, 1n, Symbol.for("s"), {}, [], new Error("plain")]) {
      expect($isRun(value)).toBe(false)
    }
  })

  test("the call site runs what runs and keeps the rest", async () => {
    const config = Config.String("FAST_TEST_UNSET")
    const at = (c: unknown) => Effect.gen(function* () { return yield* site(c) })
    expect(await Effect.runPromise(at(Effect.succeed(1)))).toBe(1)
    expect(await Effect.runPromise(at(Exit.succeed(2)))).toBe(2)
    expect(await Effect.runPromise(at(config))).toBe(config)
    expect(await Effect.runPromise(at(Db))).toBe(Db)
    expect(await Effect.runPromise(at(3))).toBe(3)
    expect(await Effect.runPromiseExit(at(Effect.fail("e")))).toEqual(Exit.fail("e"))
  })
})

describe("$direct", () => {
  test("is the registered symbol vibelang/direct", () => {
    expect($direct).toBe(Symbol.for("vibelang/direct"))
  })

  test("a caller uses the plain body when it is there and the Effect function when it is not", async () => {
    let directCalls = 0
    const double$direct = (n: number) => (directCalls++, n * 2)
    // D10's pair as the projector writes it.
    function double(...args: [number]) { return Effect.sync(() => double$direct(...args)) }
    ;(double as any)[$direct] = double$direct
    const triple = Effect.fnUntraced(function* (n: number) { return n * 3 })
    // `(($t = (f[$direct] ?? f)(x)), f[$direct] ? $t : ($isRun($t) ? (yield* $t) : $t))` in another module.
    const at = (f: (n: number) => Effect.Effect<number>, x: number) => Effect.gen(function* () {
      let $t
      return (($t = ((f as any)[$direct] ?? f)(x)), (f as any)[$direct] ? $t : ($isRun($t) ? yield* $t : $t))
    })
    expect(await Effect.runPromise(at(double, 21))).toBe(42)
    expect(directCalls).toBe(1)
    expect(await Effect.runPromise(at(triple, 14))).toBe(42)
    expect(await Effect.runPromise(Effect.gen(function* () { return yield* double(21) }))).toBe(42)
    expect(directCalls).toBe(2)
  })
})

describe("fast calls", () => {
  test("a suspended fast call can be inspected without running and composed through pipe", async () => {
    const events: string[] = []
    const entry = $fast(function*() {
      events.push("eager")
      yield* Effect.sync(() => { events.push("resumed") })
      return 21
    })
    const pending = entry() as Effect.Effect<number>
    expect(JSON.parse(JSON.stringify(pending))).toEqual({ _id: "Effect", op: "vibelang/FastCall" })
    expect(inspect(pending)).toContain("vibelang/FastCall")
    const composed = pending.pipe(Effect.map(n => n * 2))
    expect(events).toEqual(["eager"])
    expect(await Effect.runPromise(composed)).toBe(42)
    expect(events).toEqual(["eager", "resumed"])
  })

  test("a body that never suspends gives its value without a fiber", () => {
    const double = function* (n: number) { return n * 2 }
    const viaExit = function* (n: number) { return (yield* Effect.succeed(n)) * 2 }
    for (const entry of [perFunction(double), $fast(double), perFunction(viaExit), $fast(viaExit)]) {
      expect(entry(21)).toBe(42)
    }
  })

  test("$done keeps a returned value the run check would run", async () => {
    const config = Config.String("FAST_TEST_UNSET")
    const effect = Effect.succeed(1)
    const exit = Exit.fail("data")
    expect($done(42)).toBe(42)
    expect($done(config)).toBe(config)
    for (const value of [effect, exit]) {
      const body = function* () { return value }
      for (const shape of shapes) {
        expect(await Effect.runPromise(call(shape, body))).toBe(value)
      }
    }
  })

  test("a body that suspends gives a one-shot Effect that resumes it", async () => {
    const events: Array<string> = []
    const body = function* (n: number) {
      events.push("before")
      const doubled = yield* Effect.sync(() => n * 2)
      events.push("after")
      return doubled
    }
    for (const entry of [perFunction(body), $fast(body)]) {
      events.length = 0
      const t = entry(21) as Effect.Effect<number>
      expect($isRun(t)).toBe(true)
      expect(events).toEqual(["before"])
      expect(await Effect.runPromise(t)).toBe(42)
      expect(events).toEqual(["before", "after"])
      const again = await Effect.runPromiseExit(t)
      expect(Exit.isFailure(again) && Cause.squash(again.cause)).toMatchObject({ _tag: "FastCallRanTwice" })
    }
  })

  test("all three calls give the same results for values, Exits, and suspensions", async () => {
    const inner = perFunction(function* () { return yield* Effect.sync(() => 5) })
    const bodies = [
      function* () { return 1 },
      function* () { return (yield* Exit.succeed(2)) + (yield* Effect.succeed(3)) },
      function* () { return yield* Effect.promise(() => Promise.resolve(4)) },
      function* () { return (yield* site<number>(inner())) + 1 }
    ]
    for (const body of bodies) {
      const [slow, ...fast] = await exits(body)
      for (const exit of fast) expect(exit).toEqual(slow)
    }
  })

  describe("handlers", () => {
    interface Approval { approve(request: string): Effect.Effect<boolean> }
    class Approval extends $service<Approval>("fast-test/Approval") {}
    $control(Approval, ["approve"], [1])

    // examples/approval's release.
    const release = function* (version: string) {
      if (!(yield* (yield* Approval).approve(`deploy ${version} to staging`))) return "staging declined"
      if (!(yield* (yield* Approval).approve(`deploy ${version} to production`))) return "production declined"
      return `released ${version}`
    }
    const release$fast = perFunction(release)
    // A second level: a fast call whose body makes a fast call that suspends.
    const label = function* (version: string) {
      const outcome = yield* site<string>(release$fast(version))
      return `[${outcome}]`
    }

    for (const shape of shapes) {
      test(`${shape}: a tail resume continues the body mid-call`, async () => {
        const program = handle(call(shape, release, "v1"), Approval, {
          approve: (_request: string, k: any) => Effect.succeed($tailResume(k, true))
        })
        expect(await Effect.runPromise(program)).toBe("released v1")
      })

      test(`${shape}: two resumes mid-body through two nested fast calls`, async () => {
        const decisions = [true, false]
        const log: Array<string> = []
        const program = handle(call(shape, label, "v1"), Approval, {
          approve: (request: string, k: any) => Effect.sync(() => {
            const approved = decisions[log.length] ?? false
            log.push(`review: ${request}: ${approved ? "yes" : "no"}`)
            return $tailResume(k, approved)
          })
        })
        expect(await Effect.runPromise(program)).toBe("[production declined]")
        expect(log).toEqual(["review: deploy v1 to staging: yes", "review: deploy v1 to production: no"])
      })

      test(`${shape}: a non-tail resume runs the clause's rest after the resumed body`, async () => {
        const log: Array<string> = []
        const program = handle(call(shape, release, "v2"), Approval, {
          approve: (request: string, k: any) => Effect.gen(function* () {
            log.push(`before ${request}`)
            const after = yield* resume(k, true)
            log.push(`after ${request}`)
            return after
          })
        })
        expect(await Effect.runPromise(program)).toBe("released v2")
        expect(log).toEqual([
          "before deploy v2 to staging",
          "before deploy v2 to production",
          "after deploy v2 to production",
          "after deploy v2 to staging"
        ])
      })

      test(`${shape}: a continuation resumed twice is refused by the kernel`, async () => {
        const program = handle(call(shape, release, "v4"), Approval, {
          approve: (_request: string, k: any) => Effect.gen(function* () {
            yield* resume(k, true)
            return yield* resume(k, false)
          })
        })
        const exit = await Effect.runPromiseExit(program)
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({ _tag: "ContinuationAlreadyConsumed" })
      })
    }

    test("outside every handler all three calls fail the same way: the control is missing", async () => {
      const [slow, ...fast] = await exits(release, "v3")
      for (const exit of fast) expect(exit).toEqual(slow)
      expect(Exit.isFailure(slow) && String(Cause.squash(slow.cause))).toContain("fast-test/Approval")
    })
  })

  describe("interruption", () => {
    for (const shape of shapes) {
      test(`${shape}: interrupting a suspended call runs its cleanup`, async () => {
        const events: Array<string> = []
        const exit = await Effect.runPromise(Effect.gen(function* () {
          const started = yield* Deferred.make<void>()
          const body = function* () {
            events.push("start")
            yield* $finally(
              Effect.andThen(Deferred.succeed(started, undefined), Effect.never),
              Effect.sync(() => { events.push("cleanup") })
            )
            events.push("unreachable")
          }
          const child = yield* Effect.forkChild(call(shape, body))
          yield* Deferred.await(started)
          yield* Fiber.interrupt(child)
          return yield* Fiber.await(child)
        }))
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
        expect(events).toEqual(["start", "cleanup"])
      })
    }

    test("an interrupt pending at the call arrives after the eager part, as for a $direct call", async () => {
      // The slow call takes the interrupt before the body starts; a fast
      // call runs the body to its first suspension first.
      const run = async (shape: Shape) => {
        const events: Array<string> = []
        const body = function* () {
          events.push("eager part")
          yield* Effect.sync(() => { events.push("after suspension") })
        }
        // The call site sits in the generator that requests the interrupt.
        const exit = await Effect.runPromiseExit(Effect.gen(function* () {
          const self = yield* Effect.fiber
          self.interruptUnsafe(self.id)
          if (shape === "slow") return yield* Effect.fnUntraced(body)()
          return yield* site((shape === "$fast" ? $fast(body) : perFunction(body))())
        }))
        return { interrupted: Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause), events }
      }
      expect(await run("slow")).toEqual({ interrupted: true, events: [] })
      expect(await run("per-function")).toEqual({ interrupted: true, events: ["eager part"] })
      expect(await run("$fast")).toEqual({ interrupted: true, events: ["eager part"] })
    })
  })

  describe("the eager depth bound of $fast", () => {
    // n + 1 nested $fast entries, with a leaf that may suspend.
    const chain$fast: (n: number, suspendAtLeaf: boolean) => unknown = $fast(function* chain(n: number, suspendAtLeaf: boolean): Body<number> {
      if (n === 0) return suspendAtLeaf ? yield* Effect.sync(() => 0) : 0
      return 1 + (yield* site<number>(chain$fast(n - 1, suspendAtLeaf)))
    })

    test("100 nested eager runs finish eagerly; the 101st makes the slow call", async () => {
      expect(chain$fast(99, false)).toBe(99)
      const deferred = chain$fast(100, false)
      expect($isRun(deferred)).toBe(true)
      expect(await Effect.runPromise(deferred as Effect.Effect<number>)).toBe(100)
    })

    test("100,000-deep recursion on Bun succeeds with a pure leaf and with a suspending leaf", async () => {
      for (const suspendAtLeaf of [false, true]) {
        expect(await Effect.runPromise(Effect.gen(function* () { return yield* site(chain$fast(100_000, suspendAtLeaf)) }))).toBe(100_000)
      }
    }, 30_000)

    test("100,000-deep recursion on Node succeeds, with bodies of 0 and 80 live locals", () => {
      // 80 live locals per body overflow Node's stack at 888 nested levels.
      const locals = Array.from({ length: 80 }, (_, i) => `let v${i} = n + ${i}`).join("; ")
      const sum = Array.from({ length: 80 }, (_, i) => `v${i}`).join(" + ")
      const script = `
        import { Effect } from "effect"
        import { $fast, $isRun } from "vibelang-runtime"
        const site = function* (t) { return $isRun(t) ? yield* t : t }
        const small$fast = $fast(function* (n) { if (n === 0) return yield* Effect.sync(() => 0); return 1 + (yield* site(small$fast(n - 1))) })
        const large$fast = $fast(function* (n) { if (n === 0) return 0; ${locals}; const r = yield* site(large$fast(n - 1)); return r + 1 + (${sum}) - (${sum}) })
        for (const entry of [small$fast, large$fast]) console.log(String(await Effect.runPromise(Effect.gen(function* () { return yield* site(entry(100000)) }))))
      `
      const packageDir = fileURLToPath(new URL("..", import.meta.url))
      const result = Bun.spawnSync(["node", "--input-type=module", "-e", script], { cwd: packageDir, stdout: "pipe", stderr: "pipe" })
      expect(result.exitCode).toBe(0)
      expect(result.stderr.toString()).toBe("")
      expect(result.stdout.toString().trim().split("\n")).toEqual(["100000", "100000"])
    }, 60_000)

    test("100,000-deep recursion on Node succeeds with 200 live locals", () => {
      // A cap of 500 overflowed at 485 eager levels with this body size.
      const locals = Array.from({ length: 200 }, (_, i) => `let v${i} = n + ${i}`).join("; ")
      const sum = Array.from({ length: 200 }, (_, i) => `v${i}`).join(" + ")
      const script = `
        import { Effect } from "effect"
        import { $fast, $isRun } from "vibelang-runtime"
        const site = function* (t) { return $isRun(t) ? yield* t : t }
        const recurse$fast = $fast(function* (n) {
          if (n === 0) return 0
          ${locals}
          const r = yield* site(recurse$fast(n - 1))
          return r + 1 + (${sum}) - (${sum})
        })
        console.log(String(await Effect.runPromise(Effect.gen(function* () { return yield* site(recurse$fast(100000)) }))))
      `
      const packageDir = fileURLToPath(new URL("..", import.meta.url))
      const result = Bun.spawnSync(["node", "--input-type=module", "-e", script], { cwd: packageDir, stdout: "pipe", stderr: "pipe" })
      expect(result.exitCode).toBe(0)
      expect(result.stderr.toString()).toBe("")
      expect(result.stdout.toString().trim()).toBe("100000")
    }, 60_000)

    test("a defect in the eager part leaves the depth count intact", () => {
      const throws = $fast(function* (): Body<number> { throw new Error("boom") })
      for (let i = 0; i < 600; i++) expect($isRun(throws())).toBe(true)
      expect(chain$fast(99, false)).toBe(99)
    })
  })

  describe("failures in the eager part", () => {
    class Invalid extends Data.TaggedError("Invalid")<{ readonly n: number }> {}

    test("an expected failure surfaces at the call site, inside the caller's catch", async () => {
      const body = function* () {
        yield* Effect.fail(new Invalid({ n: 1 }))
        return 0
      }
      const [slow, ...fast] = await exits(body)
      expect(slow).toEqual(Exit.fail(new Invalid({ n: 1 })))
      for (const exit of fast) expect(exit).toEqual(slow)
      for (const shape of shapes) {
        const recovered = $catch(call(shape, body), (e) => Effect.succeed(`caught ${e._tag}`))
        expect(await Effect.runPromise(recovered)).toBe("caught Invalid")
      }
    })

    test("a thrown defect is the same Die as the slow call's, before or after an Exit step", async () => {
      const defect = new TypeError("boom")
      const first = function* (): Body<number> { throw defect }
      const later = function* (): Body<number> {
        yield* Effect.succeed(1)
        throw defect
      }
      for (const body of [first, later]) {
        const [slow, ...fast] = await exits(body)
        expect(Exit.isFailure(slow) && Cause.squash(slow.cause)).toBe(defect)
        for (const exit of fast) expect(exit).toEqual(slow)
        for (const shape of shapes) {
          // A catch handles expected failures only (D13); a Cause catch sees the defect.
          expect(await Effect.runPromiseExit($catch(call(shape, body), () => Effect.succeed(0)))).toEqual(slow)
          const seen = $catchCause(call(shape, body), (cause) => Effect.succeed(Cause.hasDies(cause)))
          expect(await Effect.runPromise(seen)).toBe(true)
        }
      }
    })

    test("where a defect surfaces: a throw in the per-function entry's first step reaches the caller's body", async () => {
      // Effect bodies hold no JavaScript try (D54 keeps it to plain
      // functions), so this is visible only to code the projector never
      // writes. The fiber makes it the same Die at the caller's step.
      const run = async (shape: Shape, body: () => Body<number>) => {
        let caughtInJavaScript = false
        const exit = await Effect.runPromiseExit(Effect.gen(function* () {
          try {
            if (shape === "slow") return yield* Effect.fnUntraced(body)()
            return yield* site<number>((shape === "$fast" ? $fast(body) : perFunction(body))())
          } catch {
            caughtInJavaScript = true
            return -1
          }
        }))
        return { caughtInJavaScript, died: Exit.isFailure(exit) && Cause.hasDies(exit.cause) }
      }
      const first = function* (): Body<number> { throw new TypeError("boom") }
      const later = function* (): Body<number> {
        yield* Effect.succeed(1)
        throw new TypeError("boom")
      }
      expect(await run("slow", first)).toEqual({ caughtInJavaScript: false, died: true })
      expect(await run("$fast", first)).toEqual({ caughtInJavaScript: false, died: true })
      expect(await run("per-function", first)).toEqual({ caughtInJavaScript: true, died: false })
      expect(await run("per-function", later)).toEqual({ caughtInJavaScript: false, died: true })
    })

    test("a throw while binding the body's parameters is a defect for all three calls", async () => {
      const body = function* ({ n }: { readonly n: number }) { return n }
      for (const exit of await exits(body, undefined as any)) {
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBeInstanceOf(TypeError)
      }
    })

    test("a RangeError in the eager part is a Die without escaping or retrying", async () => {
      const defect = new RangeError("eager body")
      for (const afterExit of [false, true]) {
        let attempts = 0
        const body = function* (): Body<number> {
          attempts++
          if (afterExit) yield* Effect.succeed(0)
          throw defect
        }
        const slow = await Effect.runPromiseExit(call("slow", body))
        expect(slow).toEqual(Exit.die(defect))
        attempts = 0
        // Call outside the fiber: an escaping JavaScript exception fails
        // here, rather than being caught by the caller's generator step.
        const pending = $fast(body)() as Effect.Effect<number>
        expect(attempts).toBe(1)
        expect(await Effect.runPromiseExit(pending)).toEqual(slow)
        expect(attempts).toBe(1)
      }
    })

    test("a throw after a real suspension is the slow call's Die", async () => {
      const defect = new TypeError("after suspension")
      for (const shape of shapes) {
        const events: Array<string> = []
        const body = function* (): Body<number> {
          events.push("eager")
          yield* Effect.promise(() => Promise.resolve().then(() => { events.push("on fiber") }))
          events.push("resumed")
          throw defect
        }
        const slow = await Effect.runPromiseExit(call("slow", body))
        expect(slow).toEqual(Exit.die(defect))
        events.length = 0
        let program: Effect.Effect<number>
        if (shape === "slow") {
          program = call(shape, body)
          expect(events).toEqual([])
        } else {
          program = (shape === "$fast" ? $fast(body) : perFunction(body))() as Effect.Effect<number>
          expect(events).toEqual(["eager"])
        }
        expect(await Effect.runPromiseExit(program)).toEqual(slow)
        expect(events).toEqual(["eager", "on fiber", "resumed"])
      }
    })

    test("a defect three fast calls down surfaces at the outermost call site", async () => {
      const defect = new RangeError("deep")
      const leaf = perFunction(function* (): Body<number> {
        yield* Effect.succeed(0)
        throw defect
      })
      const middle = $fast(function* () { return 1 + (yield* site<number>(leaf())) })
      const top = function* () { return 1 + (yield* site<number>(middle())) }
      for (const exit of await exits(top)) {
        expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(defect)
      }
    })

    test("a failure after a suspension matches the slow call", async () => {
      const body = function* () {
        const n = yield* Effect.sync(() => 1)
        return yield* Effect.fail(`failed after ${n}`)
      }
      const [slow, ...fast] = await exits(body)
      for (const exit of fast) expect(exit).toEqual(slow)
    })
  })
})

test("$fast shares the native recursion reservation and releases it before suspension", async () => {
  const { $eager } = await import("vibelang-runtime")
  let entered = 0
  const fast = $fast(function* () {
    entered++
    yield* Effect.yieldNow
    return 42
  })
  const previous = $eager.depth
  $eager.depth = $eager.limit
  let pending: unknown
  try {
    pending = fast()
    expect(entered).toBe(0)
    expect($eager.depth).toBe($eager.limit)
  } finally {
    $eager.depth = previous
  }
  expect(await Effect.runPromise(pending as Effect.Effect<number>)).toBe(42)
  expect($eager.depth).toBe(previous)
  const a = fast(), b = fast()
  expect($eager.depth).toBe(previous)
  expect(await Effect.runPromise(Effect.all([a as Effect.Effect<number>, b as Effect.Effect<number>], { concurrency: "unbounded" }))).toEqual([42, 42])
  expect($eager.depth).toBe(previous)
})

test("published native budget is balanced through nested calls, defects and fiber switches", async () => {
  const { $eager } = await import("vibelang-runtime")
  const initial = $eager.depth
  const defect = new Error("bridge defect")
  const fast = $fast(function* () {
    expect($eager.depth).toBe($eager.limit - 32 + 16)
    yield* Effect.yieldNow
    expect($eager.depth).toBe(initial)
    return 42
  })
  const pending = $eager.call(32, () => {
    expect($eager.depth).toBe($eager.limit - 32)
    expect(() => $eager.call(16, () => { throw defect })).toThrow(defect)
    expect($eager.depth).toBe($eager.limit - 32)
    const program = fast()
    expect($eager.depth).toBe($eager.limit - 32)
    return program
  })
  expect($eager.depth).toBe(initial)
  expect(await Effect.runPromise(pending as Effect.Effect<number>)).toBe(42)
  const a = $eager.call(32, () => fast())
  const b = $eager.call(32, () => fast())
  expect($eager.depth).toBe(initial)
  expect(await Effect.runPromise(Effect.all([a as Effect.Effect<number>, b as Effect.Effect<number>], { concurrency: "unbounded" }))).toEqual([42, 42])
  expect($eager.depth).toBe(initial)
})
