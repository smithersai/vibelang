import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  Action,
  compileActionContract,
  compileDurableSource,
  ContentIntegrityError,
  CoordinatorCrash,
  Deployment,
  digest,
  DurableActionDefect,
  DurableExecutionAlreadyFailed,
  DurableExecutor,
  DurableStore,
  PlanArtifact,
  Provider,
  validatePlanTemplate,
  Worker,
  type LoopNode,
  type PlanTemplate
} from "./index.ts"

const stepContract = compileActionContract(`
import { Action } from "vibelang:flows"
class StepFailed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Step extends Action<
  (input: { remaining: number; total: number }) => Result<{ remaining: number; total: number }, StepFailed>
> {}
`, {
  fileName: "contracts/loop-step.vibe",
  exportName: "Step",
  id: "test/loop/Step",
  version: 1
})
if (!stepContract.ok) throw new Error(JSON.stringify(stepContract.diagnostics))

const Step = Action.fromDescriptor<
  { remaining: number; total: number },
  { remaining: number; total: number },
  { code: string }
>(stepContract.descriptor)

const stepCalls: { remaining: number; total: number }[] = []

const actionBindings = Object.freeze([
  Object.freeze({ moduleSpecifier: "test:loop-actions", exportName: "Step", descriptor: Step.descriptor })
])

const source = `
import { durable, loopWhile } from "vibelang:flows"
import { Step } from "test:loop-actions"

throw new Error("the authored loop module must never execute")

export const Countdown = durable(function Countdown(input: { count: number }) {
  return loopWhile(
    { remaining: input.count, total: 0 },
    state => state.remaining > 0,
    state => Step.run({ remaining: state.remaining, total: state.total }),
    5
  )
})
`

const compileCountdown = (text = source) => compileDurableSource(text, {
  fileName: "flows/loop.vibe",
  flowId: "test/loop/Countdown",
  flowVersion: 1,
  actions: actionBindings
})

const deploymentFor = (plan: PlanTemplate, id: string) => Deployment.build({
  id,
  flow: PlanArtifact.load(PlanArtifact.encode(plan)),
  pools: [Worker.pool("loop-worker", {
    target: "typescript-bun",
    providers: [
      Provider.provide(Step, ({ remaining, total }) => {
        stepCalls.push({ remaining, total })
        return { remaining: remaining - 1, total: total + remaining }
      }, {
        implementationId: "loop-step",
        implementationVersion: "1",
        recovery: { mode: "repeatable", maxAttempts: 3 }
      })
    ]
  })]
})

const loopNode = (plan: PlanTemplate): LoopNode => {
  const node = plan.nodes.find((candidate) => candidate.kind === "loop")
  if (node?.kind !== "loop") throw new Error("expected a loop Plan node")
  return node
}

const roundEvents = (store: DurableStore, executionId: string) =>
  store.journal(executionId)
    .filter((event) => event.type === "loop_round_materialized")
    .map((event) => event.payload as {
      readonly round: number
      readonly childNodeId: string
      readonly inputDigest: string
      readonly stateDigest: string
    })

test("loopWhile lowers to a format-2 round-budgeted template without evaluating source", () => {
  const compiled = compileCountdown()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.plan.formatVersion).toBe(2)
  expect(compiled.plan.nodes).toHaveLength(1)
  const node = loopNode(compiled.plan)
  expect(node).toMatchObject({
    kind: "loop",
    condition: {
      kind: "binary",
      operator: "gt",
      left: { kind: "state", path: ["remaining"] },
      right: { kind: "literal", value: 0 }
    },
    actionId: Step.descriptor.id,
    actionContractDigest: Step.descriptor.contractDigest,
    body: {
      kind: "object",
      fields: {
        remaining: { kind: "state", path: ["remaining"] },
        total: { kind: "state", path: ["total"] }
      }
    },
    maxRounds: 5
  })
  // Zero rounds returns the initial state; otherwise the Action success. The
  // loop value descriptor is their canonical union.
  expect(compiled.plan.flowSchemas?.success).toMatchObject({
    shape: "structural",
    descriptor: { kind: "union" }
  })
  const shifted = compileCountdown(`// unrelated leading edit\n${source}`)
  if (!shifted.ok) throw new Error(JSON.stringify(shifted.diagnostics))
  expect(shifted.plan.nodes[0]!.id).toBe(node.id)
})

test("unsupported loop spellings and budgets fail closed while raw while-loops stay rejected", () => {
  const fixtures: readonly { readonly text: string; readonly code: string }[] = [
    // captures in the condition template
    { text: source.replace("state => state.remaining > 0,", "state => input.count > 0,"), code: "VIBE4121" },
    // runtime budget
    { text: source.replace("\n    5\n", "\n    input.count\n"), code: "VIBE4121" },
    // zero budget
    { text: source.replace("\n    5\n", "\n    0\n"), code: "VIBE4121" },
    // budget over the ceiling
    { text: source.replace("\n    5\n", "\n    1001\n"), code: "VIBE4121" },
    // A non-boolean condition is rejected by the typed intrinsic declaration
    // itself before template lowering begins.
    { text: source.replace("state => state.remaining > 0,", "state => state.remaining,"), code: "VIBE4100" },
    // block bodies stay outside the bounded template subset
    {
      text: source.replace(
        "state => Step.run({ remaining: state.remaining, total: state.total }),",
        "state => { return Step.run({ remaining: state.remaining, total: state.total }) },"
      ),
      code: "VIBE4121"
    }
  ]
  for (const fixture of fixtures) {
    const compiled = compileCountdown(fixture.text)
    expect(compiled.ok).toBe(false)
    if (compiled.ok) throw new Error(`expected failure: ${fixture.text}`)
    expect(compiled.diagnostics[0]!.code).toBe(fixture.code)
  }

  // An authored `while` statement still fails closed: only the explicit
  // compiler-owned template creates a durable loop.
  const rawWhile = compileCountdown(`
import { durable } from "vibelang:flows"
import { Step } from "test:loop-actions"
export const Countdown = durable(function Countdown(input: { count: number }) {
  while (input.count > 0) { }
  return Step.run({ remaining: input.count, total: 0 })
})
`)
  expect(rawWhile.ok).toBe(false)
  if (rawWhile.ok) throw new Error("expected raw while rejection")
  expect(rawWhile.diagnostics[0]!.code).toBe("VIBE4107")
})

test("forged loop artifacts cannot downgrade the format, widen the budget, or invent operators", () => {
  const compiled = compileCountdown()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))

  const downgraded = JSON.parse(JSON.stringify(compiled.plan))
  downgraded.formatVersion = 1
  const { digest: _downgraded, ...downgradedSemantic } = downgraded
  expect(() => validatePlanTemplate({ ...downgradedSemantic, digest: digest(downgradedSemantic) }))
    .toThrow("require Plan format version 2")

  const widened = JSON.parse(JSON.stringify(compiled.plan))
  widened.nodes[0].maxRounds = 1001
  const { digest: _widened, ...widenedSemantic } = widened
  expect(() => validatePlanTemplate({ ...widenedSemantic, digest: digest(widenedSemantic) }))
    .toThrow("round ceiling")

  const forgedOperator = JSON.parse(JSON.stringify(compiled.plan))
  forgedOperator.nodes[0].condition.operator = "call"
  const { digest: _forgedOperator, ...forgedSemantic } = forgedOperator
  expect(() => validatePlanTemplate({ ...forgedSemantic, digest: digest(forgedSemantic) }))
    .toThrow("unsupported binary operator")

  const reloaded = PlanArtifact.decode(PlanArtifact.encode(compiled.plan))
  expect(reloaded.digest).toBe(compiled.plan.digest)
})

test("rounds chain durable state, terminate on the condition, and record exact round evidence", async () => {
  const compiled = compileCountdown()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const node = loopNode(compiled.plan)
  const deployment = deploymentFor(compiled.plan, "loop-run")
  const store = new DurableStore()
  stepCalls.length = 0
  try {
    const executor = new DurableExecutor(deployment, store)
    expect(await executor.execute({ count: 3 }, { executionId: "loop-run" })).toEqual({
      remaining: 0,
      total: 6
    })
    expect(stepCalls).toEqual([
      { remaining: 3, total: 0 },
      { remaining: 2, total: 3 },
      { remaining: 1, total: 5 }
    ])
    const rounds = roundEvents(store, "loop-run")
    expect(rounds.map((event) => event.round)).toEqual([0, 1, 2])
    for (const [index, event] of rounds.entries()) {
      expect(event.childNodeId).toBe(`loop-${digest({ loopNodeId: node.id, round: index })}`)
      expect(store.getNode("loop-run", event.childNodeId).status).toBe("succeeded")
    }
    // Zero-round loops return the initial state without dispatching anything.
    expect(await executor.execute({ count: 0 }, { executionId: "loop-zero" })).toEqual({
      remaining: 0,
      total: 0
    })
    expect(stepCalls).toHaveLength(3)
    expect(roundEvents(store, "loop-zero")).toEqual([])

    // Replay of the completed loop adopts the journaled value.
    expect(await executor.execute({ count: 3 }, { executionId: "loop-run" })).toEqual({
      remaining: 0,
      total: 6
    })
    expect(stepCalls).toHaveLength(3)
  } finally {
    store.close()
  }
})

test("round budget exhaustion is a durable terminal defect, not a hang", async () => {
  const compiled = compileCountdown()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const node = loopNode(compiled.plan)
  const deployment = deploymentFor(compiled.plan, "loop-budget")
  const store = new DurableStore()
  stepCalls.length = 0
  try {
    const executor = new DurableExecutor(deployment, store)
    let observed: unknown
    try {
      await executor.execute({ count: 9 }, { executionId: "loop-budget" })
      throw new Error("expected the round budget to fail the loop")
    } catch (error) {
      observed = error
    }
    expect(observed).toBeInstanceOf(DurableActionDefect)
    expect((observed as DurableActionDefect).defect).toMatchObject({
      name: "LoopRoundBudgetExhausted",
      maxRounds: 5
    })
    expect(stepCalls).toHaveLength(5)
    expect(store.getNode("loop-budget", node.id).status).toBe("defect")
    expect(store.getExecution("loop-budget").status).toBe("failed")

    // Replay observes the committed terminal outcome without new rounds.
    await expect(executor.execute({ count: 9 }, { executionId: "loop-budget" }))
      .rejects.toBeInstanceOf(DurableExecutionAlreadyFailed)
    expect(stepCalls).toHaveLength(5)
  } finally {
    store.close()
  }
})

test("round materialization is fenced against aliasing and missing predecessors", async () => {
  const compiled = compileCountdown()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const node = loopNode(compiled.plan)
  const deployment = deploymentFor(compiled.plan, "loop-alias")
  const store = new DurableStore()
  stepCalls.length = 0
  try {
    await new DurableExecutor(deployment, store).execute({ count: 2 }, { executionId: "loop-alias" })
    const rounds = roundEvents(store, "loop-alias")
    expect(rounds).toHaveLength(2)
    // Same round identity with different instantiated evidence fails closed.
    expect(() => store.materializeLoopRound("loop-alias", node.id, {
      round: 1,
      childNodeId: rounds[1]!.childNodeId,
      inputDigest: digest({ forged: true }),
      stateDigest: rounds[1]!.stateDigest
    })).toThrow(ContentIntegrityError)
    expect(() => store.materializeLoopRound("loop-alias", node.id, {
      round: 1,
      childNodeId: rounds[1]!.childNodeId,
      inputDigest: rounds[1]!.inputDigest,
      stateDigest: digest({ forged: true })
    })).toThrow(ContentIntegrityError)
    // A caller-selected round child id is never accepted.
    expect(() => store.materializeLoopRound("loop-alias", node.id, {
      round: 1,
      childNodeId: "forged-round-child",
      inputDigest: rounds[1]!.inputDigest,
      stateDigest: rounds[1]!.stateDigest
    })).toThrow("not derived from its loop node and round ordinal")
    // A round without a durably succeeded predecessor cannot materialize.
    expect(() => store.materializeLoopRound("loop-alias", node.id, {
      round: 5,
      childNodeId: `loop-${digest({ loopNodeId: node.id, round: 5 })}`,
      inputDigest: rounds[1]!.inputDigest,
      stateDigest: rounds[1]!.stateDigest
    })).toThrow("no committed predecessor")
  } finally {
    store.close()
  }
})

test("crashes after round materialization and round success resume the chain without reinvocation", async () => {
  const compiled = compileCountdown()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const node = loopNode(compiled.plan)
  const deployment = deploymentFor(compiled.plan, "loop-crash")
  const directory = mkdtempSync(join(tmpdir(), "vibe-loop-"))
  const database = join(directory, "durable.sqlite")
  const round1Child = `loop-${digest({ loopNodeId: node.id, round: 1 })}`
  stepCalls.length = 0
  try {
    // Crash immediately after round 1's atomic materialization commit.
    const materializeStore = new DurableStore(database)
    try {
      await expect(new DurableExecutor(deployment, materializeStore).execute({ count: 3 }, {
        executionId: "loop-crash",
        afterLoopRoundMaterialized: (nodeId, _childNodeId, round) => {
          if (round === 1) throw new CoordinatorCrash(nodeId)
        }
      })).rejects.toBeInstanceOf(CoordinatorCrash)
      expect(stepCalls).toEqual([{ remaining: 3, total: 0 }])
      expect(materializeStore.getNode("loop-crash", round1Child).status).toBe("pending")
    } finally {
      materializeStore.close()
    }

    // Crash immediately after round 1's child success commit, before exposure.
    const successStore = new DurableStore(database)
    try {
      await expect(new DurableExecutor(deployment, successStore).execute({ count: 3 }, {
        executionId: "loop-crash",
        afterNodeAdopted: (nodeId) => {
          if (nodeId === round1Child) throw new CoordinatorCrash(nodeId)
        }
      })).rejects.toBeInstanceOf(CoordinatorCrash)
      expect(stepCalls).toEqual([
        { remaining: 3, total: 0 },
        { remaining: 2, total: 3 }
      ])
      expect(successStore.getNode("loop-crash", round1Child).status).toBe("succeeded")
    } finally {
      successStore.close()
    }

    // Resume replays committed rounds and finishes the remaining round only.
    const resumedStore = new DurableStore(database)
    try {
      expect(await new DurableExecutor(deployment, resumedStore).execute({ count: 3 }, {
        executionId: "loop-crash"
      })).toEqual({ remaining: 0, total: 6 })
      expect(stepCalls).toEqual([
        { remaining: 3, total: 0 },
        { remaining: 2, total: 3 },
        { remaining: 1, total: 5 }
      ])
      expect(roundEvents(resumedStore, "loop-crash").map((event) => event.round)).toEqual([0, 1, 2])
    } finally {
      resumedStore.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("two independent connections converge on one durable round chain", async () => {
  const compiled = compileCountdown()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const deployment = deploymentFor(compiled.plan, "loop-race")
  const directory = mkdtempSync(join(tmpdir(), "vibe-loop-race-"))
  const database = join(directory, "durable.sqlite")
  stepCalls.length = 0
  const storeA = new DurableStore(database)
  const storeB = new DurableStore(database)
  try {
    const [first, second] = await Promise.all([
      new DurableExecutor(deployment, storeA).execute({ count: 3 }, { executionId: "loop-race" }),
      new DurableExecutor(deployment, storeB).execute({ count: 3 }, { executionId: "loop-race" })
    ])
    expect(first).toEqual({ remaining: 0, total: 6 })
    expect(second).toEqual({ remaining: 0, total: 6 })
    // One winner per round across both coordinators; the chain stays exact.
    expect(stepCalls).toEqual([
      { remaining: 3, total: 0 },
      { remaining: 2, total: 3 },
      { remaining: 1, total: 5 }
    ])
    expect(roundEvents(storeA, "loop-race").map((event) => event.round)).toEqual([0, 1, 2])
  } finally {
    storeA.close()
    storeB.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
