import { expect, test } from "bun:test"
import fc from "fast-check"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Latch from "effect/Latch"
import { Patterns } from "vibelang-runtime/experimental"
import * as BoundedModule from "vibelang-runtime/experimental/patterns/Bounded"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { Bounded, PatternError } = Patterns

const invalidPriorities = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1.5, 2 ** 53]

const refusal = async <A, E>(effect: Effect.Effect<A, E>) => {
  const error = await Effect.runPromise(Effect.flip(effect))
  expect(error).toBeInstanceOf(PatternError)
  return error as InstanceType<typeof PatternError>
}

test("Bounded: the subpath module is the namespace's module", () => {
  expect(BoundedModule.run).toBe(Bounded.run)
})

test("Bounded.run keeps within the concurrency bound and starts the highest priority first", async () => {
  const program = Effect.gen(function*() {
    // Both admitted members park on a gate the test holds shut, so the third
    // cannot start until the test opens it.
    const gate = yield* Latch.make(false)
    const admitted = yield* Latch.make(false)
    const started: Array<string> = []
    let live = 0
    let peak = 0
    const member = (name: string) =>
      Effect.gen(function*() {
        started.push(name)
        live = live + 1
        peak = Math.max(peak, live)
        if (started.length === 2) yield* admitted.open
        yield* gate.await
        live = live - 1
        return name.toUpperCase()
      })
    const fiber = yield* Effect.forkChild(
      Bounded.run(
        { a: member("a"), b: member("b"), c: member("c"), d: member("d"), e: member("e") },
        { concurrency: 2, priorities: { e: 9 } }
      ),
      { startImmediately: true }
    )
    yield* admitted.await
    const whileHeld = [...started]
    yield* gate.open
    const values = yield* Fiber.join(fiber)
    return { whileHeld, peak, values }
  })
  const { whileHeld, peak, values } = await Effect.runPromise(program)
  expect(whileHeld).toHaveLength(2)
  expect(whileHeld[0]).toBe("e")
  expect(peak).toBe(2)
  expect(values).toEqual({ a: "A", b: "B", c: "C", d: "D", e: "E" })
})

test("Bounded.run reads only own per-member priorities for prototype-shaped names", async () => {
  const starts: Array<string> = []
  const member = (name: string) => Effect.sync(() => (starts.push(name), name))
  const declared = Object.fromEntries([
    ["low", member("low")],
    ["constructor", member("constructor")],
    ["high", member("high")]
  ])
  await Effect.runPromise(Bounded.run(declared, { concurrency: 1, priorities: { low: 1, high: 10 } }))
  expect(starts).toEqual(["high", "low", "constructor"])
  starts.length = 0
  await Effect.runPromise(Bounded.run(declared, { concurrency: 1, priorities: { low: 1, constructor: 5, high: 10 } }))
  expect(starts).toEqual(["high", "constructor", "low"])
})

test("Bounded.run gives every member the default priority unless it names its own", async () => {
  const starts: Array<string> = []
  const member = (name: string) => Effect.sync(() => (starts.push(name), name))
  await Effect.runPromise(Bounded.run(
    { a: member("a"), b: member("b"), c: member("c") },
    { concurrency: 1, priority: 5, priorities: { a: 1, c: 9 } }
  ))
  expect(starts).toEqual(["c", "b", "a"])
})

test("Bounded.run returns own data properties for prototype-shaped member names", async () => {
  const names = ["__proto__", "constructor", "toString", "normal"]
  const result = await Effect.runPromise(Bounded.run(
    Object.fromEntries(names.map((name) => [name, Effect.succeed(`${name}-value`)])),
    { concurrency: 2 }
  ))
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
  for (const name of names) {
    expect(Object.hasOwn(result, name)).toBe(true)
    expect(result[name]).toBe(`${name}-value`)
  }
})

test("Bounded.run round-trips generated record keys as own properties", async () => {
  const candidates = ["__proto__", "constructor", "toString", "", "0", "10", "雪", "é", "💾"]
  let seed = 0x51a7e
  const generated = Array.from({ length: 64 }, () => {
    const remaining = [...candidates]
    const ids: Array<string> = []
    while (remaining.length > 0) {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0
      ids.push(remaining.splice(seed % remaining.length, 1)[0]!)
    }
    return ids
  })
  for (const ids of generated) {
    const expected = new Map(ids.map((id, index) => [id, `${index}:${id}`]))
    const declared = Object.create(null) as Record<string, Effect.Effect<string>>
    for (const [id, value] of expected) {
      Object.defineProperty(declared, id, { configurable: true, enumerable: true, value: Effect.succeed(value), writable: true })
    }
    const result = await Effect.runPromise(Bounded.run(declared, { concurrency: 3 }))
    for (const [id, value] of expected) {
      expect(Object.hasOwn(result, id)).toBe(true)
      expect(result[id]).toBe(value)
    }
  }
})

test("Bounded.run refuses every unsafe member priority before running a member", async () => {
  let ran = 0
  for (const priority of invalidPriorities) {
    const perMember = await refusal(Bounded.run(
      { unstable: Effect.sync(() => (ran += 1)) },
      { concurrency: 1, priorities: { unstable: priority } }
    ))
    expect(perMember.code).toBe("invalid_decorator")
    expect(perMember.message).toBe(`Bounded priority for member "unstable" must be a safe integer, received ${priority}`)
    const fallback = await refusal(Bounded.run({ unstable: Effect.sync(() => (ran += 1)) }, { concurrency: 1, priority }))
    expect(fallback.message).toBe(`Bounded priority for member "unstable" must be a safe integer, received ${priority}`)
  }
  expect(ran).toBe(0)
})

test("Bounded.run refuses a priority for an unknown member", async () => {
  let ran = 0
  const failure = await refusal(Bounded.run(
    { known: Effect.sync(() => (ran += 1, "done")) },
    { concurrency: 1, priorities: { typo: 10 } }
  ))
  expect(failure.code).toBe("invalid_decorator")
  expect(failure.message).toBe("Bounded declares a priority for the unknown member \"typo\"")
  expect(ran).toBe(0)
})

test("Bounded.run fails with a typed PatternError for an empty record or an invalid width", async () => {
  const none: Readonly<Record<string, Effect.Effect<number>>> = {}
  const empty = await refusal(Bounded.run(none, { concurrency: 1 }))
  expect(empty.code).toBe("invalid_decorator")
  expect(empty.message).toBe("Bounded requires at least one member")
  for (const concurrency of [-1, 0, 1.5, Number.NaN]) {
    const width = await refusal(Bounded.run({ a: Effect.succeed(1) }, { concurrency }))
    expect(width.code).toBe("invalid_decorator")
    expect(width.message).toBe(`Bounded concurrency must be a positive safe integer, received ${concurrency}`)
  }
})

test("Bounded.run lets a caller recover the refusal by tag", async () => {
  const none: Readonly<Record<string, Effect.Effect<number>>> = {}
  const recovered = await Effect.runPromise(
    Effect.catchTag(Bounded.run(none, { concurrency: 1 }), "PatternError", (error) => Effect.succeed(error.code))
  )
  expect(recovered).toBe("invalid_decorator")
})

test("Bounded.run fails with the first member failure", async () => {
  const exit = await Effect.runPromiseExit(Bounded.run(
    { a: Effect.succeed(1), b: Effect.fail("b refused" as const) },
    { concurrency: 1 }
  ))
  expect(exit._tag).toBe("Failure")
  expect(await Effect.runPromise(Effect.flip(Bounded.run({ b: Effect.fail("b refused" as const) }, { concurrency: 1 }))))
    .toBe("b refused")
})

test("Bounded.run reads its options at the call, not when the Effect runs", async () => {
  const members: Record<string, Effect.Effect<string>> = { a: Effect.succeed("a") }
  const priorities: Record<string, number> = { a: 1 }
  const options = { concurrency: 1, priorities }
  const program = Bounded.run(members, options)
  members["late"] = Effect.succeed("late")
  priorities["ghost"] = 3
  options.concurrency = 0
  expect(await Effect.runPromise(program)).toEqual({ a: "a" })
})

test("property: a bounded run starts members in descending priority, declaration order among equals, and returns every value", async () => {
  await checkProperty(fc, {
    name: "patterns-bounded-priority-order",
    rule: "VIP-73: Bounded.run runs a fixed set of Effects at most concurrency at a time, highest priority first",
    command: "bun test tests/experimental-patterns-bounded.test.ts",
    arbitrary: fc.record({
      ranks: fc.array(fc.integer({ min: -3, max: 3 }), { minLength: 1, maxLength: 8 }),
      concurrency: fc.integer({ min: 1, max: 9 })
    }),
    numRuns: 200,
    check: async ({ ranks, concurrency }: { readonly ranks: ReadonlyArray<number>; readonly concurrency: number }) => {
      const starts: Array<string> = []
      const names = ranks.map((_, index) => `m${index}`)
      const members = Object.fromEntries(names.map((name) => [name, Effect.sync(() => (starts.push(name), `${name}!`))]))
      const priorities = Object.fromEntries(names.map((name, index) => [name, ranks[index]!]))
      const result = await Effect.runPromise(Bounded.run(members, { concurrency, priorities }))
      const expected = names
        .map((name, index) => ({ name, rank: ranks[index]!, index }))
        .sort((left, right) => right.rank - left.rank || left.index - right.index)
        .map(({ name }) => name)
      expect(starts).toEqual(expected)
      expect(Object.keys(result).sort()).toEqual([...names].sort())
      for (const name of names) expect(result[name]).toBe(`${name}!`)
    }
  })
})
