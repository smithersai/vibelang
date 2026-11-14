import { expect, test } from "bun:test"
import fc from "fast-check"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Latch from "effect/Latch"
import { Patterns } from "vibelang-runtime/experimental"
import * as QuarantineModule from "vibelang-runtime/experimental/patterns/Quarantine"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { PatternError, Quarantine } = Patterns

class Boom extends Data.TaggedError("Boom")<{ readonly member: string }> {}

const refusal = async <A, E>(effect: Effect.Effect<A, E>) => {
  const error = await Effect.runPromise(Effect.flip(effect))
  expect(error).toBeInstanceOf(PatternError)
  return error as InstanceType<typeof PatternError>
}

test("Quarantine: the subpath module is the namespace's module", () => {
  expect(QuarantineModule.run).toBe(Quarantine.run)
  expect(QuarantineModule.settle).toBe(Quarantine.settle)
})

test("Quarantine.settle keeps input-bearing member errors in its cause", async () => {
  const input = { value: "caller data" }
  const memberError = { reason: "refused", input }
  const outcomes = await Effect.runPromise(Quarantine.run({ member: Effect.fail(memberError) }, { policy: "quarantine" }))
  const failure = await refusal(Quarantine.settle(outcomes))
  expect(failure.cause).toEqual([{ member: "member", error: memberError }])
  expect((failure.cause as ReadonlyArray<{ readonly error: unknown }>)[0]!.error).toBe(memberError)
})

test("Quarantine.run isolates a failing member and lets its siblings finish", async () => {
  const finished: Array<string> = []
  const settle = (name: string, yields: number) =>
    Effect.gen(function*() {
      for (let index = 0; index < yields; index++) yield* Effect.yieldNow
      finished.push(name)
      return `${name}-done`
    })
  const result = await Effect.runPromise(Quarantine.run({
    alpha: settle("alpha", 3),
    beta: Effect.fail(new Boom({ member: "beta" })),
    gamma: settle("gamma", 1)
  }, { policy: "quarantine" }))
  expect(result.alpha).toEqual({ _tag: "Succeeded", member: "alpha", value: "alpha-done" })
  expect(result.gamma).toEqual({ _tag: "Succeeded", member: "gamma", value: "gamma-done" })
  expect(result.beta).toEqual({ _tag: "Quarantined", member: "beta", error: new Boom({ member: "beta" }) })
  expect(Object.isFrozen(result.beta)).toBe(true)
  expect([...finished].sort()).toEqual(["alpha", "gamma"])
})

test("Quarantine.run returns own data properties for prototype-shaped member names", async () => {
  const names = ["__proto__", "constructor", "toString", "normal"]
  const result = await Effect.runPromise(Quarantine.run(
    Object.fromEntries(names.map((name) => [name, Effect.succeed(`${name}-value`)])),
    { policy: "quarantine" }
  ))
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  for (const name of names) {
    expect(Object.hasOwn(result, name)).toBe(true)
    expect(result[name]).toEqual({ _tag: "Succeeded", member: name, value: `${name}-value` })
  }
})

test("Quarantine.run interrupts siblings on the first failure under the halt policy", async () => {
  const finished: Array<string> = []
  const slow = Effect.gen(function*() {
    for (let index = 0; index < 5; index++) yield* Effect.yieldNow
    finished.push("alpha")
    return "alpha-done"
  })
  const failure = await Effect.runPromise(Effect.flip(
    Quarantine.run({ alpha: slow, beta: Effect.fail(new Boom({ member: "beta" })) }, { policy: "halt" })
  ))
  expect(failure).toEqual(new Boom({ member: "beta" }))
  expect(finished).toEqual([])
})

test("Quarantine.run returns every member's plain value under the halt policy when none fails", async () => {
  const result = await Effect.runPromise(Quarantine.run(
    { alpha: Effect.succeed("alpha-value"), beta: Effect.succeed("beta-value") },
    { policy: "halt" }
  ))
  expect(result).toEqual({ alpha: "alpha-value", beta: "beta-value" })
})

test("Quarantine.run bounds how many members run at once", async () => {
  const program = Effect.gen(function*() {
    const gate = yield* Latch.make(false)
    const admitted = yield* Latch.make(false)
    let started = 0
    let live = 0
    let peak = 0
    const member = () =>
      Effect.gen(function*() {
        started = started + 1
        live = live + 1
        peak = Math.max(peak, live)
        if (started === 2) yield* admitted.open
        yield* gate.await
        live = live - 1
        return "done"
      })
    const fiber = yield* Effect.forkChild(
      Quarantine.run({ a: member(), b: member(), c: member(), d: member() }, { policy: "quarantine", concurrency: 2 }),
      { startImmediately: true }
    )
    yield* admitted.await
    const whileHeld = started
    yield* gate.open
    const values = yield* Fiber.join(fiber)
    return { whileHeld, peak, values }
  })
  const { whileHeld, peak, values } = await Effect.runPromise(program)
  expect(whileHeld).toBe(2)
  expect(peak).toBe(2)
  expect(values).toEqual(Object.fromEntries(
    ["a", "b", "c", "d"].map((member) => [member, { _tag: "Succeeded", member, value: "done" }])
  ))
})

test("Quarantine.settle settles a clean result and fails on quarantined members", async () => {
  const clean = await Effect.runPromise(Quarantine.settle({
    a: { _tag: "Succeeded", member: "a", value: 1 },
    b: { _tag: "Succeeded", member: "b", value: 2 }
  }))
  expect(clean).toEqual({ a: 1, b: 2 })
  const error = await refusal(Quarantine.settle({
    a: { _tag: "Succeeded", member: "a", value: 1 } as const,
    c: { _tag: "Quarantined", member: "c", error: new Boom({ member: "c" }) } as const,
    b: { _tag: "Quarantined", member: "b", error: new Boom({ member: "b" }) } as const
  }))
  expect(error.code).toBe("quarantined")
  expect(error.message).toBe("Quarantined members: b, c")
  expect(error.cause).toEqual([
    { member: "b", error: new Boom({ member: "b" }) },
    { member: "c", error: new Boom({ member: "c" }) }
  ])
})

test("Quarantine.run fails with a typed PatternError for an empty record or an invalid width", async () => {
  const none: Readonly<Record<string, Effect.Effect<number>>> = {}
  const empty = await refusal(Quarantine.run(none, { policy: "quarantine" }))
  expect(empty.code).toBe("invalid_decorator")
  expect(empty.message).toBe("Quarantine requires at least one member")
  for (const concurrency of [0, -2, 1.5, Number.NaN]) {
    const width = await refusal(Quarantine.run({ a: Effect.succeed(1) }, { policy: "quarantine", concurrency }))
    expect(width.code).toBe("invalid_decorator")
    expect(width.message).toBe(`Quarantine concurrency must be a positive safe integer, received ${concurrency}`)
  }
  expect(await Effect.runPromise(Quarantine.run({ a: Effect.succeed(1) }, { policy: "halt", concurrency: "unbounded" })))
    .toEqual({ a: 1 })
})

test("Quarantine.isQuarantined recognises only the full structural outcome", () => {
  expect(Quarantine.isQuarantined({ _tag: "Quarantined", member: "a", error: 1 })).toBe(true)
  expect(Quarantine.isQuarantined({ _tag: "Quarantined" })).toBe(false)
  expect(Quarantine.isQuarantined({ _tag: "Quarantined", member: 1, error: "e" })).toBe(false)
  expect(Quarantine.isQuarantined({ _tag: "Quarantined", error: "e" })).toBe(false)
  expect(Quarantine.isQuarantined({ _tag: "Quarantined", member: "a", value: "e" })).toBe(false)
  expect(Quarantine.isQuarantined({ _tag: "quarantined", member: "a", error: "e" })).toBe(false)
  expect(Quarantine.isQuarantined({ _tag: "Settled" })).toBe(false)
  expect(Quarantine.isQuarantined(undefined)).toBe(false)
})

test("Quarantine.isSucceeded recognises only the full structural outcome", () => {
  expect(Quarantine.isSucceeded({ _tag: "Succeeded", member: "a", value: 1 })).toBe(true)
  expect(Quarantine.isSucceeded({ _tag: "Succeeded", member: "a" })).toBe(false)
  expect(Quarantine.isSucceeded({ _tag: "Succeeded", member: 1, value: 1 })).toBe(false)
  expect(Quarantine.isSucceeded({ _tag: "Succeeded", member: "a", value: 1, extra: true })).toBe(false)
  expect(Quarantine.isSucceeded(Object.defineProperty({ _tag: "Succeeded", member: "a" }, "value", { value: 1 }))).toBe(false)
  expect(Quarantine.isSucceeded(null)).toBe(false)
})

test("Quarantine.settle nests outcome-shaped successes without unwrapping them twice", async () => {
  for (const value of [
    { _tag: "Quarantined", member: "legitimate", error: "ordinary data" } as const,
    { _tag: "Succeeded", member: "impostor", value: 1 } as const
  ]) {
    const outcomes = await Effect.runPromise(Quarantine.run({ a: Effect.succeed(value) }, { policy: "quarantine" }))
    expect(await Effect.runPromise(Quarantine.settle(outcomes))).toEqual({ a: value })
  }
})

test("Quarantine.settle refuses malformed outcomes", async () => {
  const failure = await refusal(Quarantine.settle({
    b: 2,
    a: { _tag: "Succeeded", member: "a", value: 1, extra: true }
  } as never))
  expect(failure.code).toBe("invalid_input")
  expect(failure.message).toBe("Invalid quarantine outcomes: a, b")
})

test("Quarantine outcome checks never invoke accessors and survive hostile proxies", () => {
  let calls = 0
  const accessor = Object.defineProperty({ member: "a", error: "e" }, "_tag", {
    enumerable: true,
    get: () => {
      calls += 1
      return "Quarantined"
    }
  })
  const proxy = new Proxy({}, {
    ownKeys: () => {
      throw new Error("hostile")
    }
  })
  let descriptors = 0
  const descriptorProxy = new Proxy({}, {
    ownKeys: () => ["_tag", "member", "error"],
    getOwnPropertyDescriptor: (_target, key) => {
      descriptors += 1
      if (descriptors > 3) throw new Error("hostile descriptor")
      return { configurable: true, enumerable: true, value: key === "_tag" ? "Quarantined" : "value" }
    }
  })
  expect(Quarantine.isQuarantined(accessor)).toBe(false)
  expect(Quarantine.isSucceeded(proxy)).toBe(false)
  expect(Quarantine.isQuarantined(descriptorProxy)).toBe(false)
  expect(calls).toBe(0)
})

test("Quarantine.run reads its options at the call, not when the Effect runs", async () => {
  const members: Record<string, Effect.Effect<string, string>> = { a: Effect.succeed("a") }
  const options: { policy: "quarantine"; concurrency: number } = { policy: "quarantine", concurrency: 1 }
  const program = Quarantine.run(members, options)
  members["late"] = Effect.fail("late")
  options.concurrency = 0
  expect(await Effect.runPromise(program)).toEqual({ a: { _tag: "Succeeded", member: "a", value: "a" } })
})

test("property: under quarantine every member settles, and settle fails exactly when one failed", async () => {
  await checkProperty(fc, {
    name: "patterns-quarantine-settles-every-member",
    rule: "VIP-73: Quarantine.run continues past a failed member and reports each member as Succeeded or Quarantined",
    command: "bun test tests/experimental-patterns-quarantine.test.ts",
    arbitrary: fc.record({
      fails: fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
      concurrency: fc.oneof(fc.integer({ min: 1, max: 9 }), fc.constant("unbounded" as const))
    }),
    numRuns: 200,
    check: async ({ fails, concurrency }: { readonly fails: ReadonlyArray<boolean>; readonly concurrency: number | "unbounded" }) => {
      const names = fails.map((_, index) => `m${index}`)
      const members = Object.fromEntries(names.map((name, index) => [
        name,
        fails[index] ? Effect.fail(`${name}-failed`) : Effect.succeed(`${name}-ok`)
      ]))
      const result = await Effect.runPromise(Quarantine.run(members, { policy: "quarantine", concurrency }))
      expect(Object.keys(result)).toEqual(names)
      names.forEach((name, index) => {
        expect(result[name]).toEqual(fails[index]
          ? { _tag: "Quarantined", member: name, error: `${name}-failed` }
          : { _tag: "Succeeded", member: name, value: `${name}-ok` })
      })
      const failed = names.filter((_, index) => fails[index]).sort()
      if (failed.length === 0) {
        expect(await Effect.runPromise(Quarantine.settle(result)))
          .toEqual(Object.fromEntries(names.map((name) => [name, `${name}-ok`])))
      } else {
        const error = await refusal(Quarantine.settle(result))
        expect(error.message).toBe(`Quarantined members: ${failed.join(", ")}`)
      }
    }
  })
})
