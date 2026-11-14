import { expect, test } from "bun:test"
import fc from "fast-check"
import { Effect } from "effect"
import { Patterns } from "vibelang-runtime/experimental"
import * as DelegationChainModule from "vibelang-runtime/experimental/patterns/DelegationChain"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const { DelegationChain, PatternError, Trellis } = Patterns
type DelegationError = Patterns.DelegationChain.DelegationError

const plan: Patterns.Trellis.Plan = {
  sequence: [
    { agent: { goal: "a" } },
    { parallel: [{ agent: { goal: "b" } }, { agent: { goal: "c" } }] }
  ]
}

const bounds = { tierOrder: ["weak", "strong"], maxDepth: 3, maxDeriskRounds: 2 } as const

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
const flip = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect))

test("DelegationChain: the pattern subpath and the Experimental namespace export the same module", () => {
  expect(DelegationChainModule.run).toBe(DelegationChain.run)
  expect(new DelegationChain.DelegationError({ code: "leaf_failed", path: "root", message: "m" })._tag).toBe("DelegationError")
})

test("DelegationChain.run reports every plan refusal before executing any leaf", async () => {
  const invalid = { sequence: [{ agent: { goal: "" } }, { agent: { goal: "ok", seat: 1 } }] }
  const trace: Array<string> = []
  const failure = await flip(DelegationChain.run("ship it", {
    ...bounds,
    refine: () => Effect.succeed("goal"),
    plan: () => Effect.succeed(invalid),
    derisk: () => Effect.succeed(true),
    execute: { weak: () => Effect.sync(() => trace.push("weak")), strong: () => Effect.sync(() => trace.push("strong")) },
    review: () => Effect.sync(() => (trace.push("review"), true)),
    settle: () => Effect.sync(() => trace.push("settle"))
  }))
  const refusals = Trellis.validate(invalid, { fuel: 3, depth: 3, fanout: 3 })
  expect(refusals).toHaveLength(2)
  expect(failure).toBeInstanceOf(Trellis.TrellisError)
  const refused = failure as Patterns.Trellis.TrellisError
  expect(refused.code).toBe(refusals[0]!.code)
  expect(refused.path).toBe(refusals[0]!.path)
  expect(refused.message).toBe(refusals[0]!.message)
  expect(refused.cause).toEqual({ rounds: [], remaining: 3, refusals })
  expect(trace).toEqual([])
})

test("DelegationChain.run stops the derisk loop at the first approved round", async () => {
  const calls: Array<string> = []
  await run(DelegationChain.run("ship it", {
    ...bounds,
    refine: (args) => Effect.sync(() => (calls.push(`refine ${args.prompt}`), "goal")),
    plan: () => Effect.sync(() => (calls.push("plan"), plan)),
    derisk: () => Effect.sync(() => (calls.push("derisk"), { approved: true })),
    execute: { weak: () => Effect.succeed("ok"), strong: () => Effect.succeed("ok") },
    review: () => Effect.succeed({ approved: true }),
    settle: ({ leaves }) => Effect.succeed(leaves)
  }))
  expect(calls).toEqual(["refine ship it", "plan", "derisk"])
})

test("DelegationChain.run revises the plan while derisk withholds approval", async () => {
  const requests: Array<unknown> = []
  const settled = await run(DelegationChain.run("ship it", {
    ...bounds,
    refine: () => Effect.succeed("goal"),
    plan: (request) => Effect.sync(() => (requests.push(request), { agent: { goal: "a" } })),
    derisk: (request) => Effect.sync(() => (requests.push(request), { approved: request.round === 2 })),
    execute: { weak: () => Effect.succeed("ok"), strong: () => Effect.succeed("ok") },
    review: () => Effect.succeed({ approved: true }),
    settle: ({ deriskExhausted, leaves }) => Effect.succeed({ deriskExhausted, leaves })
  }))
  expect(requests).toEqual([
    { goal: "goal", round: 1 },
    { goal: "goal", plan: { agent: { goal: "a" } }, round: 1 },
    { goal: "goal", round: 2, previous: { agent: { goal: "a" } }, derisk: { approved: false } },
    { goal: "goal", plan: { agent: { goal: "a" } }, round: 2 }
  ])
  expect(settled).toEqual({ deriskExhausted: false, leaves: ["ok"] })
})

test("DelegationChain.run escalates a leaf that fails on the weakest tier and succeeds on the next", async () => {
  const attempted: Array<unknown> = []
  const settled = await run(DelegationChain.run("ship it", {
    ...bounds,
    budget: { maxMinutes: 5 },
    refine: () => Effect.succeed("goal"),
    plan: () => Effect.succeed({ agent: { goal: "a" } }),
    derisk: () => Effect.succeed({ approved: true }),
    execute: {
      weak: (work) => Effect.suspend(() => (attempted.push(work), Effect.fail("weak tier gave up"))),
      strong: (work) => Effect.sync(() => (attempted.push(work), "strong result"))
    },
    review: () => Effect.succeed({ approved: true }),
    settle: ({ leaves }) => Effect.succeed(leaves)
  }))
  // One call per tier: the chain never retries a tier itself.
  expect(attempted).toEqual([
    { leaf: { goal: "a", path: "root" }, tier: "weak", goal: "goal", budget: { maxMinutes: 5 } },
    { leaf: { goal: "a", path: "root" }, tier: "strong", goal: "goal", budget: { maxMinutes: 5 } }
  ])
  expect(settled).toEqual(["strong result"])
})

test("DelegationChain.run escalates a leaf whose result the review rejects", async () => {
  const reviewed: Array<string> = []
  const settled = await run(DelegationChain.run("ship it", {
    ...bounds,
    refine: () => Effect.succeed("goal"),
    plan: () => Effect.succeed({ agent: { goal: "a" } }),
    derisk: () => Effect.succeed({ approved: true }),
    execute: { weak: () => Effect.succeed("thin"), strong: () => Effect.succeed("thorough") },
    review: (request) =>
      Effect.sync(() => {
        if (request.stage === "leaf") reviewed.push(request.tier)
        return { approved: request.stage === "chain" || request.output === "thorough" }
      }),
    settle: ({ leaves }) => Effect.succeed(leaves)
  }))
  expect(reviewed).toEqual(["weak", "strong"])
  expect(settled).toEqual(["thorough"])
})

test("DelegationChain.run fails with the leaf path once every tier has failed", async () => {
  let attempts = 0
  const failure = await flip(DelegationChain.run("ship it", {
    ...bounds,
    refine: () => Effect.succeed("goal"),
    plan: () => Effect.succeed({ sequence: [{ agent: { goal: "a" } }] }),
    derisk: () => Effect.succeed({ approved: true }),
    execute: {
      weak: () => Effect.suspend(() => (attempts += 1, Effect.fail("weak failed"))),
      strong: () => Effect.suspend(() => (attempts += 1, Effect.fail("strong failed")))
    },
    review: () => Effect.succeed({ approved: true }),
    settle: ({ leaves }) => Effect.succeed(leaves)
  }))
  expect(failure).toBeInstanceOf(DelegationChain.DelegationError)
  expect(failure).toMatchObject({ code: "leaf_failed", path: "root.sequence[0]", message: "No tier settled the leaf at root.sequence[0]" })
  expect((failure as DelegationError).cause).toEqual([{ tier: "weak", error: "weak failed" }, { tier: "strong", error: "strong failed" }])
  expect(attempts).toBe(bounds.tierOrder.length)
})

test("DelegationChain.run fails an exhausted rejected ladder without settling its leaf", async () => {
  const attempts = new Map<string, number>()
  const reviewed: Array<string> = []
  let settled = false
  const tier = ({ tier }: { readonly tier: string }) =>
    Effect.sync(() => (attempts.set(tier, (attempts.get(tier) ?? 0) + 1), `${tier}-candidate`))
  const failure = await flip(DelegationChain.run("ship it", {
    ...bounds,
    refine: () => Effect.succeed("goal"),
    plan: () => Effect.succeed({ sequence: [{ agent: { goal: "a" } }] }),
    derisk: () => Effect.succeed({ approved: true }),
    execute: { weak: tier, strong: tier },
    review: (request) =>
      Effect.sync(() => {
        if (request.stage === "leaf") reviewed.push(request.tier)
        return { approved: request.stage === "chain" }
      }),
    settle: ({ leaves }) => Effect.sync(() => (settled = true, leaves))
  }))
  expect(failure).toMatchObject({ _tag: "DelegationError", code: "leaf_failed", path: "root.sequence[0]" })
  expect((failure as DelegationError).cause).toEqual([{ tier: "weak", rejected: true }, { tier: "strong", rejected: true }])
  expect(attempts).toEqual(new Map([["weak", 1], ["strong", 1]]))
  expect(reviewed).toEqual(["weak", "strong"])
  expect(settled).toBe(false)
})

test("DelegationChain.run hands settle every leaf output in plan order, and the chain review the plan and its leaves", async () => {
  const chain: Array<unknown> = []
  const settled = await run(DelegationChain.run("ship it", {
    ...bounds,
    refine: () => Effect.succeed("goal"),
    plan: () => Effect.succeed(plan),
    derisk: () => Effect.succeed({ approved: true }),
    execute: { weak: ({ leaf }) => Effect.succeed(leaf.goal.toUpperCase()), strong: () => Effect.succeed("unused") },
    review: (request) => Effect.sync(() => (request.stage === "chain" && chain.push(request), "approved")),
    settle: (request) => Effect.succeed(request)
  }))
  expect(settled).toEqual({ prompt: "ship it", goal: "goal", plan, leaves: ["A", "B", "C"], review: "approved", deriskExhausted: false })
  expect(chain).toEqual([{ stage: "chain", goal: "goal", plan, leaves: ["A", "B", "C"] }])
})

test("DelegationChain.run refuses a derisked plan that leaves the envelope", async () => {
  const failure = await flip(DelegationChain.run("ship it", {
    ...bounds,
    maxDepth: 1,
    refine: () => Effect.succeed("goal"),
    plan: () => Effect.succeed({ sequence: [{ agent: { goal: "a" } }] }),
    derisk: () => Effect.succeed({ approved: true }),
    execute: { weak: () => Effect.succeed("ok"), strong: () => Effect.succeed("ok") },
    review: () => Effect.succeed({ approved: true }),
    settle: ({ leaves }) => Effect.succeed(leaves)
  }))
  expect(failure).toMatchObject({ code: "depth_exceeded", path: "root.sequence[0]", message: "Plan depth 2 exceeds the envelope depth 1" })
})

test("DelegationChain.run refuses bad bounds and missing tiers before any callback runs", async () => {
  let callbacks = 0
  const called = <A>(value: A) => Effect.sync(() => (callbacks += 1, value))
  const stages = {
    refine: () => called("goal"),
    plan: () => called({ agent: { goal: "a" } }),
    derisk: () => called({ approved: true }),
    execute: { weak: () => called("ok"), strong: () => called("ok") },
    review: () => called({ approved: true }),
    settle: () => called("settled")
  }
  const cases: ReadonlyArray<readonly [Record<string, unknown>, string, string]> = [
    ...[0, -5, 1.5, Number.NaN].map((concurrency) =>
      [{ concurrency }, "invalid_bounds", `Delegation concurrency must be a positive safe integer, received ${concurrency}`] as const
    ),
    [{ maxDepth: 0 }, "invalid_bounds", "maxDepth and maxDeriskRounds must be positive safe integers"],
    [{ maxDeriskRounds: 1.5 }, "invalid_bounds", "maxDepth and maxDeriskRounds must be positive safe integers"],
    [{ tierOrder: [] }, "invalid_bounds", "tierOrder must name at least one tier, weakest first"],
    [{ tierOrder: ["weak", "expert", "oracle"] }, "missing_tier", "execute has no flow for tier expert, oracle"]
  ]
  for (const [override, code, message] of cases) {
    const failure = await flip(DelegationChain.run("ship it", { ...bounds, ...stages, ...override }))
    expect(failure).toBeInstanceOf(DelegationChain.DelegationError)
    expect(failure).toMatchObject({ code, path: "root", message })
  }
  expect(callbacks).toBe(0)
})

test("DelegationChain.run wraps a derisk PatternError with the exact delegation refusal", async () => {
  const failure = await flip(DelegationChain.run("ship it", {
    ...bounds,
    refine: () => Effect.succeed("goal"),
    plan: () => Effect.fail(new PatternError({ code: "invalid_decorator", message: "planner refused input" })),
    derisk: () => Effect.succeed({ approved: true }),
    execute: { weak: () => Effect.succeed("ok"), strong: () => Effect.succeed("ok") },
    review: () => Effect.succeed({ approved: true }),
    settle: ({ leaves }) => Effect.succeed(leaves)
  }))
  expect(failure).toBeInstanceOf(DelegationChain.DelegationError)
  expect(failure).toMatchObject({ code: "derisk_failed", path: "root", message: "planner refused input" })
})

test("DelegationChain.run wraps a leaf-review PatternError with the exact leaf refusal, and passes other review failures through", async () => {
  const reviewFailure = new PatternError({ code: "invalid_decorator", message: "review unavailable" })
  const stages = {
    ...bounds,
    refine: () => Effect.succeed("goal"),
    plan: () => Effect.succeed({ agent: { goal: "a" } }),
    derisk: () => Effect.succeed({ approved: true }),
    execute: { weak: () => Effect.succeed("candidate"), strong: () => Effect.succeed("unused") },
    settle: ({ leaves }: { readonly leaves: ReadonlyArray<unknown> }) => Effect.succeed(leaves)
  }
  const failure = await flip(DelegationChain.run("ship it", {
    ...stages,
    review: (request) => request.stage === "leaf" ? Effect.fail(reviewFailure) : Effect.succeed({ approved: true })
  }))
  expect(failure).toBeInstanceOf(DelegationChain.DelegationError)
  expect(failure).toMatchObject({ code: "leaf_failed", path: "root", message: "No tier settled the leaf at root" })
  expect((failure as DelegationError).cause).toBe(reviewFailure)
  const plain = await flip(DelegationChain.run("ship it", { ...stages, review: () => Effect.fail("review offline") }))
  expect(plain).toBe("review offline")
})

test("DelegationChain.run settles with deriskExhausted when derisk never approves", async () => {
  const calls: Array<string> = []
  const settled = await run(DelegationChain.run("ship it", {
    ...bounds,
    maxDeriskRounds: 2,
    refine: () => Effect.succeed("goal"),
    plan: ({ round }) => Effect.sync(() => (calls.push(`plan-${round}`), { agent: { goal: "a" } })),
    derisk: ({ round }) => Effect.sync(() => (calls.push(`derisk-${round}`), { approved: false })),
    execute: { weak: () => Effect.succeed("ok"), strong: () => Effect.succeed("unused") },
    review: () => Effect.succeed({ approved: true }),
    settle: ({ deriskExhausted, leaves }) => Effect.succeed({ deriskExhausted, leaves })
  }))
  expect(calls).toEqual(["plan-1", "derisk-1", "plan-2", "derisk-2"])
  expect(settled).toEqual({ deriskExhausted: true, leaves: ["ok"] })
})

test("DelegationChain.accepted reads the shared acceptance vocabulary", () => {
  for (const yes of [true, "approved", { approved: true }, { accepted: true }]) expect(DelegationChain.accepted(yes)).toBe(true)
  for (const no of [false, "yes", { approved: "true" }, Object.create({ approved: true })]) expect(DelegationChain.accepted(no)).toBe(false)
})

test("DelegationChain.run reads its options at the call, not when the Effect runs", async () => {
  const tierOrder = ["weak"]
  const options = {
    tierOrder,
    maxDepth: 1,
    maxDeriskRounds: 1,
    budget: { maxMinutes: 5 },
    refine: () => Effect.succeed("goal"),
    plan: () => Effect.succeed({ agent: { goal: "a" } }),
    derisk: () => Effect.succeed(true),
    execute: { weak: (work: Patterns.DelegationChain.Work) => Effect.succeed(work.budget) } as Record<string, (work: Patterns.DelegationChain.Work) => Effect.Effect<unknown>>,
    review: () => Effect.succeed(true),
    settle: ({ leaves }: { readonly leaves: ReadonlyArray<unknown> }) => Effect.succeed(leaves)
  }
  const program = DelegationChain.run("ship it", options)
  tierOrder.push("strong")
  options.budget.maxMinutes = 1
  options.execute["weak"] = () => Effect.succeed("swapped")
  options.maxDepth = 0
  expect(await run(program)).toEqual([{ maxMinutes: 5 }])
})

test("property: a delegation leaf settles on the first tier that succeeds and is approved, or the chain fails leaf_failed", async () => {
  await checkProperty(fc, {
    name: "patterns-delegation-chain-ladder",
    rule: "VIP-73: DelegationChain.run runs the fixed chain refine, plan, derisk, execute, review, settle, and each leaf climbs the tiers weakest first",
    command: "bun test tests/experimental-patterns-delegationchain.test.ts",
    arbitrary: fc.array(fc.constantFrom("fails", "rejected", "settles"), { minLength: 1, maxLength: 4 }),
    numRuns: 200,
    check: async (outcomes: ReadonlyArray<"fails" | "rejected" | "settles">) => {
      const tierOrder = outcomes.map((_, index) => `t${index}`)
      const called: Array<string> = []
      const execute = Object.fromEntries(tierOrder.map((tier, index) => [tier, () =>
        Effect.suspend(() => (called.push(tier), outcomes[index] === "fails" ? Effect.fail(tier) : Effect.succeed(tier)))]))
      const exit = await Effect.runPromiseExit(DelegationChain.run("p", {
        tierOrder,
        maxDepth: 1,
        maxDeriskRounds: 1,
        refine: () => Effect.succeed("goal"),
        plan: () => Effect.succeed({ agent: { goal: "a" } }),
        derisk: () => Effect.succeed(true),
        execute,
        review: (request) => Effect.succeed(request.stage === "chain" || outcomes[tierOrder.indexOf(request.tier)] === "settles"),
        settle: ({ leaves }) => Effect.succeed(leaves)
      }))
      const first = outcomes.indexOf("settles")
      expect(called).toEqual(tierOrder.slice(0, first === -1 ? outcomes.length : first + 1))
      if (first === -1) {
        expect(exit._tag).toBe("Failure")
      } else {
        expect(exit._tag === "Success" ? exit.value : undefined).toEqual([tierOrder[first]])
      }
    }
  })
})
