import { expect, test } from "bun:test"
import fc from "fast-check"
import { Effect, Fiber, Latch, Schema } from "effect"
import { Patterns } from "vibelang-runtime/experimental"
import * as TrellisModule from "vibelang-runtime/experimental/patterns/Trellis"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { Trellis } = Patterns
type Plan = Patterns.Trellis.Plan
type Leaf = Patterns.Trellis.Leaf
type TrellisError = Patterns.Trellis.TrellisError

const envelope: Patterns.Trellis.Envelope = { fuel: 3, depth: 3, fanout: 2 }

const nested: Plan = {
  parallel: [
    { agent: { goal: "a" } },
    { sequence: [{ agent: { goal: "b" } }, { agent: { goal: "c" } }] }
  ]
}

const reported = (errors: ReadonlyArray<TrellisError>): ReadonlyArray<readonly [string, string, string]> =>
  errors.map((error) => [error.code, error.path, error.message] as const)

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

test("Trellis: the pattern subpath and the Experimental namespace export the same module", () => {
  expect(TrellisModule.execute).toBe(Trellis.execute)
  const error = new Trellis.TrellisError({ code: "invalid_plan", path: "root", message: "m" })
  expect(error._tag).toBe("TrellisError")
  expect(error).toBeInstanceOf(Error)
})

test("Trellis.execute omits an absent seat from executed leaves", async () => {
  const seen: Array<Leaf> = []
  await run(Trellis.execute({ sequence: [{ agent: { goal: "a" } }, { agent: { goal: "b", seat: "reviewer" } }] }, {
    concurrency: 1,
    leaf: (input) => Effect.sync(() => seen.push(input))
  }))
  expect(Object.hasOwn(seen[0]!, "seat")).toBe(false)
  expect(seen[1]!.seat).toBe("reviewer")
})

test("Trellis.validate reports depth, fan-out, and fuel overruns at the offending path", () => {
  expect(Trellis.validate(nested, envelope)).toEqual([])
  expect(reported(Trellis.validate(nested, { fuel: 3, depth: 2, fanout: 2 }))).toEqual([
    ["depth_exceeded", "root.parallel[1].sequence[0]", "Plan depth 3 exceeds the envelope depth 2"],
    ["depth_exceeded", "root.parallel[1].sequence[1]", "Plan depth 3 exceeds the envelope depth 2"]
  ])
  expect(reported(Trellis.validate(nested, { fuel: 3, depth: 3, fanout: 1 }))).toEqual([
    ["fanout_exceeded", "root", "parallel declares 2 members, above the envelope fan-out 1"]
  ])
  expect(reported(Trellis.validate(nested, { fuel: 2, depth: 3, fanout: 2 }))).toEqual([
    ["fuel_exhausted", "root", "Plan needs 3 leaf calls but only 2 fuel remains"]
  ])
})

test("Trellis.validate refuses a value that is not a plan and an envelope that is not bounded", () => {
  expect(reported(Trellis.validate({ agent: { goal: "" } }, envelope))).toEqual([
    ["invalid_plan", "root.agent.goal", "agent.goal must be a non-empty string"]
  ])
  expect(reported(Trellis.validate({ sequence: [{ swarm: [] }] }, envelope))).toEqual([
    ["invalid_plan", "root.sequence[0]", "A plan node must be exactly one of agent, sequence, or parallel"]
  ])
  for (const bad of [{ fuel: 0, depth: 3, fanout: 2 }, { fuel: 3, depth: 1.5, fanout: 2 }, { fuel: 3, depth: 3, fanout: Number.NaN }]) {
    expect(reported(Trellis.validate(nested, bad))).toEqual([
      ["invalid_envelope", "root", "Trellis envelope fuel, depth, and fanout must be positive safe integers"]
    ])
  }
})

test("Trellis.validate reports every malformed agent and container shape", () => {
  expect(reported(Trellis.validate(null, envelope))).toEqual([
    ["invalid_plan", "root", "A plan node must be exactly one of agent, sequence, or parallel"]
  ])
  expect(reported(Trellis.validate({ agent: null }, envelope))).toEqual([["invalid_plan", "root.agent", "agent must be an object"]])
  expect(reported(Trellis.validate({ agent: { goal: "work", seat: 1 } }, envelope))).toEqual([
    ["invalid_plan", "root.agent.seat", "agent.seat must be a string"]
  ])
  expect(reported(Trellis.validate({ sequence: "not-an-array" }, envelope))).toEqual([
    ["invalid_plan", "root.sequence", "sequence must be an array"]
  ])
})

test("Trellis.validate refuses a container that holds no members, as the Plan schema does", () => {
  expect(reported(Trellis.validate({ sequence: [] }, envelope))).toEqual([["invalid_plan", "root", "sequence must hold at least one member"]])
  expect(reported(Trellis.validate({ sequence: [{ parallel: [] }] }, envelope))).toEqual([
    ["invalid_plan", "root.sequence[0]", "parallel must hold at least one member"]
  ])
  expect(Schema.decodeUnknownResult(Trellis.Plan)({ sequence: [] })._tag).toBe("Failure")
  expect(Schema.decodeUnknownResult(Trellis.Plan)({ parallel: [] })._tag).toBe("Failure")
  expect(Schema.decodeUnknownResult(Trellis.Plan)(nested)._tag).toBe("Success")
})

test("Trellis.validate refuses a container with a missing member", () => {
  const generous = { fuel: 4, depth: 3, fanout: 3 }
  const dense = { agent: { goal: "g" } }
  const holes: ReadonlyArray<readonly [unknown, string]> = [
    [{ parallel: new Array(1) }, "root.parallel[0]"],
    [{ sequence: new Array(1) }, "root.sequence[0]"],
    // eslint-disable-next-line no-sparse-arrays
    [{ sequence: [dense, , dense] }, "root.sequence[1]"],
    // eslint-disable-next-line no-sparse-arrays
    [{ parallel: [dense, , dense] }, "root.parallel[1]"],
    // eslint-disable-next-line no-sparse-arrays
    [{ sequence: [{ parallel: [dense, ,] }] }, "root.sequence[0].parallel[1]"]
  ]
  for (const [plan, path] of holes) {
    expect(Schema.is(Trellis.Plan)(plan)).toBe(false)
    expect(reported(Trellis.validate(plan, generous))).toEqual([["invalid_plan", path, "A plan node must not be a missing member"]])
  }
  expect(reported(Trellis.validate({ parallel: [dense] }, generous))).toEqual([])
})

test("Trellis.Plan decoding and Trellis.validate agree on the closed grammar", () => {
  const generous = { fuel: 20, depth: 10, fanout: 10 }
  const ambiguous = { agent: { goal: "g" }, parallel: [{ agent: { goal: "h" } }] }
  expect(Schema.decodeUnknownExit(Trellis.Plan)(ambiguous)._tag).toBe("Failure")
  expect(reported(Trellis.validate(ambiguous, generous))).toEqual([
    ["invalid_plan", "root", "A plan node must be exactly one of agent, sequence, or parallel"]
  ])
  const accepted = [
    { agent: { goal: "g" } },
    { sequence: [{ agent: { goal: "a" } }, { sequence: [{ agent: { goal: "b" } }] }] },
    { parallel: [{ agent: { goal: "a" } }, { parallel: [{ agent: { goal: "b" } }] }] },
    { agent: { goal: "g", seat: "reviewer" } }
  ]
  for (const value of accepted) expect(Trellis.validate(Schema.decodeUnknownSync(Trellis.Plan)(value), generous)).toEqual([])
  const excess = [
    { agent: { goal: "g" }, extra: true },
    { sequence: [{ agent: { goal: "g" } }], extra: true },
    { parallel: [{ agent: { goal: "g" } }], extra: true },
    { sequence: [{ agent: { goal: "g" }, extra: true }] },
    { parallel: [{ sequence: [{ agent: { goal: "g" } }], extra: true }] }
  ]
  for (const value of excess) {
    expect(Trellis.validate(value, generous)[0]?.code).toBe("invalid_plan")
    expect(Schema.decodeUnknownResult(Trellis.Plan)(value)._tag).toBe("Failure")
  }
})

test("Trellis.validate stops after one fan-out refusal without walking hallucinated members", () => {
  const refusals = Trellis.validate({ parallel: Array.from({ length: 500 }, () => null) }, { fuel: 1000, depth: 5, fanout: 2 })
  expect(refusals).toHaveLength(1)
  expect(refusals[0]?.code).toBe("fanout_exceeded")
  expect(refusals[0]?.message).toBe("parallel declares 500 members, above the envelope fan-out 2")
})

test("Trellis.validate refuses a deeply nested value at the envelope depth without walking it", () => {
  for (const terminal of [{ agent: { goal: "next" } }, { parallel: [] }]) {
    let next: unknown = terminal
    for (let depth = 0; depth < 20_000; depth++) next = { sequence: [next] }
    expect(reported(Trellis.validate(next, envelope))).toEqual([
      ["depth_exceeded", "root.sequence[0].sequence[0].sequence[0]", "Plan depth 4 exceeds the envelope depth 3"]
    ])
  }
})

test("Trellis.execute refuses invalid concurrency before a leaf runs", async () => {
  const plan: Plan = { agent: { goal: "a" } }
  for (const concurrency of [0, -5, 1.5, Number.NaN]) {
    let leaves = 0
    const failure = await run(Effect.flip(Trellis.execute(plan, { concurrency, leaf: () => Effect.sync(() => (leaves += 1, "done")) })))
    expect(failure).toBeInstanceOf(Trellis.TrellisError)
    const refused = failure as TrellisError
    expect(refused.code).toBe("invalid_envelope")
    expect(refused.path).toBe("root")
    expect(refused.message).toBe(`Trellis concurrency must be a positive safe integer, received ${concurrency}`)
    expect(leaves).toBe(0)
  }
})

test("Trellis.execute holds six parallel leaves to two in flight", async () => {
  const program = Effect.gen(function*() {
    const plan: Plan = {
      parallel: Array.from({ length: 6 }, (_, index) => ({ agent: { goal: String(index) } })) as unknown as readonly [Plan, ...Array<Plan>]
    }
    const gate = yield* Latch.make(false)
    const saturated = yield* Latch.make(false)
    let started = 0
    let inFlight = 0
    let peak = 0
    const fiber = yield* Effect.forkChild(
      Trellis.execute(plan, {
        concurrency: 2,
        leaf: () =>
          Effect.gen(function*() {
            started += 1
            inFlight += 1
            peak = Math.max(peak, inFlight)
            if (started === 2) yield* saturated.open
            yield* gate.await
            inFlight -= 1
            return "done"
          })
      }),
      { startImmediately: true }
    )
    yield* saturated.await
    const whileHeld = started
    yield* gate.open
    yield* Fiber.join(fiber)
    return { whileHeld, peak }
  })
  expect(await run(program)).toEqual({ whileHeld: 2, peak: 2 })
})

test("Trellis.execute returns parallel results in declaration order rather than completion order", async () => {
  const program = Effect.gen(function*() {
    const plan: Plan = { parallel: [{ agent: { goal: "a" } }, { agent: { goal: "b" } }, { agent: { goal: "c" } }] }
    const gates = yield* Effect.all([Latch.make(), Latch.make(), Latch.make()])
    const finished = yield* Effect.all([Latch.make(), Latch.make(), Latch.make()])
    const allStarted = yield* Latch.make()
    const completionOrder: Array<string> = []
    let started = 0
    const index = new Map([["a", 0], ["b", 1], ["c", 2]])
    const running = yield* Trellis.execute(plan, {
      concurrency: 3,
      leaf: ({ goal }) =>
        Effect.gen(function*() {
          const position = index.get(goal)!
          started += 1
          if (started === 3) yield* Latch.open(allStarted)
          yield* Latch.await(gates[position]!)
          completionOrder.push(goal)
          yield* Latch.open(finished[position]!)
          return goal.toUpperCase()
        })
    }).pipe(Effect.forkChild({ startImmediately: true }))
    yield* Latch.await(allStarted)
    for (const position of [2, 1, 0]) {
      yield* Latch.open(gates[position]!)
      yield* Latch.await(finished[position]!)
    }
    return { completionOrder, result: yield* Fiber.join(running) }
  })
  expect(await run(program)).toEqual({ completionOrder: ["c", "b", "a"], result: ["A", "B", "C"] })
})

test("Trellis.leaves and Trellis.execute keep an explicitly selected seat", async () => {
  const seated: Plan = { agent: { goal: "review", seat: "critic" } }
  expect(Trellis.leaves(seated)).toEqual([{ goal: "review", seat: "critic", path: "root" }])
  expect(Trellis.leaves(nested)).toEqual([
    { goal: "a", path: "root.parallel[0]" },
    { goal: "b", path: "root.parallel[1].sequence[0]" },
    { goal: "c", path: "root.parallel[1].sequence[1]" }
  ])
  const seen: Array<Leaf> = []
  await run(Trellis.execute(seated, { concurrency: 1, leaf: (input) => Effect.sync(() => (seen.push(input), input.goal)) }))
  expect(seen).toEqual([{ goal: "review", seat: "critic", path: "root" }])
})

test("Trellis.execute reads its plan and options at the call, not when the Effect runs", async () => {
  const goals: Array<string> = []
  const agent = { goal: "first" }
  const members: Array<Plan> = [{ agent }]
  const plan = { sequence: members as unknown as readonly [Plan, ...Array<Plan>] }
  const options = { concurrency: 1, leaf: (leaf: Leaf) => Effect.sync(() => goals.push(leaf.goal)) }
  const program = Trellis.execute(plan, options)
  agent.goal = "renamed"
  members.push({ agent: { goal: "late" } })
  options.concurrency = 0
  await run(program)
  expect(goals).toEqual(["first"])
})

const planArbitrary: fc.Arbitrary<Plan> = fc.letrec<{ readonly plan: Plan }>((tie) => ({
  plan: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.record({ agent: fc.record({ goal: fc.stringMatching(/^[a-z]{1,4}$/) }) }),
    fc.record({ sequence: fc.array(tie("plan"), { minLength: 1, maxLength: 3 }) }) as fc.Arbitrary<Plan>,
    fc.record({ parallel: fc.array(tie("plan"), { minLength: 1, maxLength: 3 }) }) as fc.Arbitrary<Plan>
  )
})).plan

const depthOf = (plan: Plan): number => {
  const members = "sequence" in plan ? plan.sequence : "parallel" in plan ? plan.parallel : undefined
  return members === undefined ? 1 : 1 + Math.max(...members.map(depthOf))
}

test("property: an admitted plan's execution calls each leaf once, in plan order for a sequence, and validate admits a plan exactly within its envelope", async () => {
  await checkProperty(fc, {
    name: "patterns-trellis-envelope",
    rule: "VIP-73: Trellis.validate checks a delegation plan a model wrote against a fixed envelope, and Trellis.execute runs it",
    command: "bun test tests/experimental-patterns-trellis.test.ts",
    arbitrary: fc.record({
      plan: planArbitrary,
      envelope: fc.record({ fuel: fc.integer({ min: 1, max: 12 }), depth: fc.integer({ min: 1, max: 5 }), fanout: fc.integer({ min: 1, max: 3 }) }),
      concurrency: fc.integer({ min: 1, max: 4 })
    }),
    numRuns: 200,
    check: async ({ plan, envelope, concurrency }: { readonly plan: Plan; readonly envelope: Patterns.Trellis.Envelope; readonly concurrency: number }) => {
      const listed = Trellis.leaves(plan)
      const refusals = Trellis.validate(plan, envelope)
      const widest = (node: Plan): number => {
        const members = "sequence" in node ? node.sequence : "parallel" in node ? node.parallel : undefined
        return members === undefined ? 0 : Math.max(members.length, ...members.map(widest))
      }
      const fits = depthOf(plan) <= envelope.depth && widest(plan) <= envelope.fanout && listed.length <= envelope.fuel
      expect(refusals.length === 0).toBe(fits)
      const called: Array<string> = []
      await run(Trellis.execute(plan, { concurrency, leaf: (leaf) => Effect.sync(() => called.push(leaf.path)) }))
      expect([...called].sort()).toEqual(listed.map((leaf) => leaf.path).sort())
      if (concurrency === 1) expect(called).toEqual(listed.map((leaf) => leaf.path))
    }
  })
})
