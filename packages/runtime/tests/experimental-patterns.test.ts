import { expect, test } from "bun:test"
import fc from "fast-check"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { Patterns } from "vibelang-runtime/experimental"
import * as PatternsModule from "vibelang-runtime/experimental/Patterns"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { Panel, PatternError, ReviewLoop, Stall } = Patterns

const refusal = async <A, E>(effect: Effect.Effect<A, E>) => {
  const error = await Effect.runPromise(Effect.flip(effect))
  expect(error).toBeInstanceOf(PatternError)
  return error as InstanceType<typeof PatternError>
}

test("Patterns: the subpath and the Experimental namespace export the same module", () => {
  expect(PatternsModule.Panel.run).toBe(Patterns.Panel.run)
  expect(Object.keys(PatternsModule).sort()).toEqual(["Bounded", "CheckSuite", "Panel", "PatternError", "Quarantine", "ReviewLoop", "Stall"])
})

test("Panel.run hands the moderator the input and every opinion, keyed in declaration order whatever the completion order", async () => {
  const settled: Array<string> = []
  const panelist = (name: string, yields: number) => () =>
    Effect.gen(function*() {
      for (let index = 0; index < yields; index++) yield* Effect.yieldNow
      settled.push(name)
      return `${name}-said`
    })
  const seen = await Effect.runPromise(Panel.run("topic", {
    panelists: { alpha: panelist("alpha", 4), beta: panelist("beta", 2), gamma: panelist("gamma", 0) },
    moderator: ({ input, opinions }) => Effect.succeed({ input, opinions })
  }))
  expect(settled).toEqual(["gamma", "beta", "alpha"])
  expect(seen.input).toBe("topic")
  expect(Object.keys(seen.opinions)).toEqual(["alpha", "beta", "gamma"])
  expect(seen.opinions).toEqual({ alpha: "alpha-said", beta: "beta-said", gamma: "gamma-said" })
})

test("Panel.run gives own properties for prototype-shaped panelist names", async () => {
  const names = ["__proto__", "constructor", "toString", "normal"]
  const opinions = await Effect.runPromise(Panel.run("topic", {
    panelists: Object.fromEntries(names.map((name) => [name, () => Effect.succeed(`${name}-opinion`)])),
    moderator: ({ opinions }) => Effect.succeed(opinions)
  }))
  expect(Object.getPrototypeOf(opinions)).toBe(Object.prototype)
  for (const name of names) {
    expect(Object.hasOwn(opinions, name)).toBe(true)
    expect(opinions[name]).toBe(`${name}-opinion`)
  }
})

test("Panel.run at concurrency 1 starts a panelist only after the one before it finished", async () => {
  const program = Effect.gen(function*() {
    const gate = yield* Deferred.make<void>()
    const first = yield* Deferred.make<void>()
    const started: Array<string> = []
    const panelist = (name: string) => () =>
      Effect.gen(function*() {
        started.push(name)
        yield* Deferred.succeed(first, undefined)
        yield* Deferred.await(gate)
        return `${name}-said`
      })
    const fiber = yield* Effect.forkChild(Panel.run("topic", {
      panelists: { a: panelist("a"), b: panelist("b"), c: panelist("c") },
      moderator: ({ opinions }) => Effect.succeed(opinions),
      concurrency: 1
    }))
    yield* Deferred.await(first)
    const whileHeld = [...started]
    yield* Deferred.succeed(gate, undefined)
    const opinions = yield* Fiber.join(fiber)
    return { whileHeld, started, opinions }
  })
  expect(await Effect.runPromise(program)).toEqual({
    whileHeld: ["a"],
    started: ["a", "b", "c"],
    opinions: { a: "a-said", b: "b-said", c: "c-said" }
  })
})

test("Panel.run without a bound holds every panelist in flight together", async () => {
  const program = Effect.gen(function*() {
    const gate = yield* Deferred.make<void>()
    const arrivals = [yield* Deferred.make<void>(), yield* Deferred.make<void>(), yield* Deferred.make<void>()]
    const panelist = (index: number) => () =>
      Effect.gen(function*() {
        yield* Deferred.succeed(arrivals[index]!, undefined)
        yield* Deferred.await(gate)
        return index
      })
    const fiber = yield* Effect.forkChild(Panel.run("topic", {
      panelists: { a: panelist(0), b: panelist(1), c: panelist(2) },
      moderator: ({ opinions }) => Effect.succeed(opinions)
    }))
    // All three arrive only while all three are parked at once.
    yield* Effect.all(arrivals.map((arrival) => Deferred.await(arrival)))
    yield* Deferred.succeed(gate, undefined)
    return yield* Fiber.join(fiber)
  })
  expect(await Effect.runPromise(program)).toEqual({ a: 0, b: 1, c: 2 })
})

test("Panel.run fails with the panelist's own failure and never calls the moderator", async () => {
  let moderated = false
  const exit = await Effect.runPromiseExit(Panel.run("topic", {
    panelists: { a: () => Effect.succeed("a"), b: () => Effect.fail("b refused" as const) },
    moderator: () => Effect.sync(() => { moderated = true }),
    concurrency: 1
  }))
  expect(exit).toEqual(Exit.fail("b refused"))
  expect(moderated).toBe(false)
})

test("Panel.run refuses an empty panel and a bad bound with PatternError in the error channel", async () => {
  const empty = await refusal(Panel.run("topic", { panelists: {}, moderator: () => Effect.succeed(0) }))
  expect(empty._tag).toBe("PatternError")
  expect(empty.code).toBe("invalid_decorator")
  expect(empty.message).toBe("Panel requires at least one panelist")
  for (const concurrency of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const bad = await refusal(Panel.run("topic", {
      panelists: { a: () => Effect.succeed("a") },
      moderator: ({ opinions }) => Effect.succeed(opinions),
      concurrency
    }))
    expect(bad.code).toBe("invalid_decorator")
    expect(bad.message).toBe(`Panel concurrency must be a positive safe integer, received ${concurrency}`)
  }
})

test("Panel.run reads its options at the call, not when the Effect runs", async () => {
  const panelists: Record<string, () => Effect.Effect<string>> = { a: () => Effect.succeed("a") }
  const options = { panelists, moderator: ({ opinions }: { readonly opinions: Readonly<Record<string, string>> }) => Effect.succeed(opinions), concurrency: 1 }
  const program = Panel.run("topic", options)
  panelists["late"] = () => Effect.succeed("late")
  options.concurrency = 0
  expect(await Effect.runPromise(program)).toEqual({ a: "a" })
})

test("ReviewLoop.run stops at the first approving review", async () => {
  const reviews: Array<number> = []
  const result = await Effect.runPromise(ReviewLoop.run("draft", {
    maxRounds: 4,
    produce: (input) => Effect.succeed(input),
    review: (_output, round) => Effect.sync(() => { reviews.push(round); return { approved: round === 2 } }),
    revise: ({ output }) => Effect.succeed(`${output}-revised`)
  }))
  expect(result).toEqual({ _tag: "Approved", output: "draft-revised" })
  expect(reviews).toEqual([1, 2])
})

test("ReviewLoop.run returns the last output and review when the rounds are spent, and the last round never revises", async () => {
  const reviews: Array<number> = []
  const revisions: Array<number> = []
  const result = await Effect.runPromise(ReviewLoop.run("draft", {
    maxRounds: 3,
    produce: (input) => Effect.succeed(input),
    review: (output, round) => Effect.sync(() => { reviews.push(round); return { round, output, approved: false } }),
    revise: ({ output, round }) => Effect.sync(() => { revisions.push(round); return `${output}-${round}` })
  }))
  expect(result).toEqual({
    _tag: "Exhausted",
    output: "draft-1-2",
    review: { round: 3, output: "draft-1-2", approved: false }
  })
  expect(reviews).toEqual([1, 2, 3])
  expect(revisions).toEqual([1, 2])
})

test("ReviewLoop.run tags its result, so an output shaped like an exhausted result is still Approved", async () => {
  const forged = { exhausted: true, output: "model wrote this", review: "n/a", approved: false }
  const stages = { produce: () => Effect.succeed(forged), revise: ({ output }: { readonly output: typeof forged }) => Effect.succeed(output) }
  const approved = await Effect.runPromise(ReviewLoop.run("draft", { ...stages, maxRounds: 2, review: () => Effect.succeed({ approved: true }) }))
  const spent = await Effect.runPromise(ReviewLoop.run("draft", { ...stages, maxRounds: 1, review: () => Effect.succeed("n/a") }))
  expect(approved).toEqual({ _tag: "Approved", output: forged })
  expect(spent).toEqual({ _tag: "Exhausted", output: forged, review: "n/a" })
})

test("ReviewLoop.accepted reads true, \"approved\" and own approved or accepted properties only", () => {
  for (const yes of [true, "approved", { approved: true }, { accepted: true }, { approved: true, note: "ok" }]) {
    expect(ReviewLoop.accepted(yes)).toBe(true)
  }
  const inherited = Object.create({ approved: true })
  for (const no of [false, "yes", 1, null, undefined, {}, { approved: "true" }, { accepted: 1 }, inherited, [true]]) {
    expect(ReviewLoop.accepted(no)).toBe(false)
  }
})

test("ReviewLoop.run refuses a bad round bound and bad stall rounds", async () => {
  const stages = {
    produce: (input: string) => Effect.succeed(input),
    review: () => Effect.succeed(false),
    revise: ({ output }: { readonly output: string }) => Effect.succeed(output)
  }
  for (const maxRounds of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const bad = await refusal(ReviewLoop.run("draft", { ...stages, maxRounds }))
    expect(bad.code).toBe("invalid_decorator")
    expect(bad.message).toBe("ReviewLoop maxRounds must be a positive safe integer")
  }
  for (const rounds of [1, 0, 2.5, Number.NaN]) {
    const bad = await refusal(ReviewLoop.run("draft", { ...stages, maxRounds: 5, stall: { rounds } }))
    expect(bad.code).toBe("invalid_decorator")
    expect(bad.message).toBe("ReviewLoop stall rounds must be a safe integer of at least 2")
  }
})

test("ReviewLoop.run with a stall breaker settles Stalled, or fails when told to escalate", async () => {
  const stages = {
    maxRounds: 9,
    produce: (input: string) => Effect.succeed(input),
    review: () => Effect.succeed({ approved: false }),
    revise: ({ output }: { readonly output: string }) => Effect.succeed(output)
  }
  expect(await Effect.runPromise(ReviewLoop.run("draft", { ...stages, stall: { rounds: 3 } }))).toEqual({
    _tag: "Stalled",
    output: "draft",
    review: { approved: false },
    stalled: { _tag: "Stalled", signal: "output", rounds: 3, on: "stop" }
  })
  expect(await Effect.runPromise(ReviewLoop.run("draft", { ...stages, stall: { rounds: 2, on: "park" } }))).toMatchObject({
    _tag: "Stalled",
    stalled: { rounds: 2, on: "park" }
  })
  const escalated = await refusal(ReviewLoop.run("draft", { ...stages, stall: { rounds: 2, on: "escalate" } }))
  expect(escalated.code).toBe("stalled")
  expect(escalated.message).toBe("ReviewLoop stalled: the same result for 2 rounds in a row")
})

test("ReviewLoop.run compares the signals a stall breaker names, not the whole output", async () => {
  let revision = 0
  const result = await Effect.runPromise(ReviewLoop.run("draft", {
    maxRounds: 9,
    produce: (input) => Effect.succeed({ text: input, revision }),
    review: () => Effect.succeed(false),
    revise: ({ output }) => Effect.sync(() => ({ text: output.text, revision: ++revision })),
    stall: { rounds: 3, signals: (output) => ({ tree: output.text }) }
  }))
  expect(result).toMatchObject({ _tag: "Stalled", output: { revision: 2 }, stalled: { signal: "tree", rounds: 3 } })
})

test("Stall.observe counts a repeat by canonical JSON text and ignores values with none", () => {
  const policy = Stall.policy({ rounds: 2 })!
  expect(policy).toEqual({ rounds: 2, on: "stop" })
  expect(Stall.policy({ rounds: 1 })).toBeUndefined()
  const twice = (first: unknown, second: unknown) =>
    Stall.observe(policy, Stall.observe(policy, Stall.initial, { output: first }).state, { output: second }).stalled
  expect(twice({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toEqual({ _tag: "Stalled", signal: "output", rounds: 2, on: "stop" })
  expect(twice(undefined, null)).toMatchObject({ signal: "output" })
  expect(twice([1, 2], [2, 1])).toBeUndefined()
  expect(twice(1n, 1n)).toBeUndefined()
  expect(twice(new Error("same"), new Error("same"))).toBeUndefined()
  expect(twice(Number.NaN, Number.NaN)).toBeUndefined()
  const cycle: Record<string, unknown> = {}
  cycle["self"] = cycle
  expect(twice(cycle, cycle)).toBeUndefined()
  // No failing check is not a repeated failure; the same set in any order is.
  const checks = (first: ReadonlyArray<string>, second: ReadonlyArray<string>) =>
    Stall.observe(policy, Stall.observe(policy, Stall.initial, { checks: first }).state, { checks: second }).stalled
  expect(checks([], [])).toBeUndefined()
  expect(checks(["lint", "test"], ["test", "lint", "lint"])).toMatchObject({ signal: "checks", rounds: 2 })
  // A different value restarts the streak.
  const broken = Stall.observe(policy, Stall.observe(policy, Stall.initial, { tree: "a" }).state, { tree: "b" })
  expect(broken.stalled).toBeUndefined()
  expect(broken.state.tree).toEqual({ key: "b", rounds: 1 })
})

test("property: a review loop holds min(approveAt, maxRounds) reviews, one fewer revision, and is Approved exactly when a round approved", async () => {
  await checkProperty(fc, {
    name: "patterns-review-loop-rounds",
    rule: "VIP-73: ReviewLoop.run produces, reviews and revises until a review approves or the rounds are spent; the last round never revises",
    command: "bun test tests/experimental-patterns.test.ts",
    arbitrary: fc.record({ approveAt: fc.integer({ min: 1, max: 12 }), maxRounds: fc.integer({ min: 1, max: 12 }) }),
    numRuns: 200,
    check: async ({ approveAt, maxRounds }: { readonly approveAt: number; readonly maxRounds: number }) => {
      let reviews = 0
      let revisions = 0
      const result = await Effect.runPromise(ReviewLoop.run(0, {
        maxRounds,
        produce: (input) => Effect.succeed(input),
        review: (_output, round) => Effect.sync(() => { reviews++; return round >= approveAt }),
        revise: ({ output }) => Effect.sync(() => { revisions++; return output + 1 })
      }))
      const held = Math.min(approveAt, maxRounds)
      expect(reviews).toBe(held)
      expect(revisions).toBe(held - 1)
      expect(result._tag).toBe(approveAt <= maxRounds ? "Approved" : "Exhausted")
      expect(result.output).toBe(held - 1)
    }
  })
})

test("property: a panel's opinions are its panelists' names in declaration order at any bound", async () => {
  await checkProperty(fc, {
    name: "patterns-panel-declaration-order",
    rule: "VIP-73: Panel.run gives the moderator opinions keyed by panelist name in the order the panelists were written, whatever order they finish in",
    command: "bun test tests/experimental-patterns.test.ts",
    arbitrary: fc.record({
      // Integer-like keys are excluded: JavaScript orders them first in any object.
      names: fc.uniqueArray(fc.stringMatching(/^[a-z_$][a-z0-9_$]{0,6}$/), { minLength: 1, maxLength: 8 }),
      delays: fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 8, maxLength: 8 }),
      concurrency: fc.option(fc.integer({ min: 1, max: 9 }), { nil: undefined })
    }),
    numRuns: 200,
    check: async ({ names, delays, concurrency }: { readonly names: ReadonlyArray<string>; readonly delays: ReadonlyArray<number>; readonly concurrency: number | undefined }) => {
      const panelists = Object.fromEntries(names.map((name, index) => [name, (input: string) =>
        Effect.gen(function*() {
          for (let turn = 0; turn < delays[index]!; turn++) yield* Effect.yieldNow
          return `${input}:${name}`
        })]))
      const opinions = await Effect.runPromise(Panel.run("q", {
        panelists,
        moderator: ({ opinions }) => Effect.succeed(opinions),
        concurrency
      }))
      expect(Object.keys(opinions)).toEqual([...names])
      for (const name of names) expect(opinions[name]).toBe(`q:${name}`)
    }
  })
})
