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
  DurableActionFailure,
  DurableExecutionCancelled,
  DurableExecutor,
  DurableStore,
  fail as durableFail,
  PlanArtifact,
  Provider,
  validatePlanTemplate,
  Worker,
  type ActionImplementation,
  type ChildFlowNode,
  type PlanTemplate
} from "./index.ts"

const doubleContract = compileActionContract(`
import { Action } from "smithers:flows"
class DoubleFailed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Double extends Action<
  (input: { value: number }) => Result<{ doubled: number }, DoubleFailed>
> {}
`, {
  fileName: "contracts/child-double.sm",
  exportName: "Double",
  id: "test/child/Double",
  version: 1
})
if (!doubleContract.ok) throw new Error(JSON.stringify(doubleContract.diagnostics))

const stampContract = compileActionContract(`
import { Action } from "smithers:flows"
class StampFailed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Stamp extends Action<
  (input: { value: number }) => Result<{ stamped: number }, StampFailed>
> {}
`, {
  fileName: "contracts/child-stamp.sm",
  exportName: "Stamp",
  id: "test/child/Stamp",
  version: 1
})
if (!stampContract.ok) throw new Error(JSON.stringify(stampContract.diagnostics))

const Double = Action.fromDescriptor<{ value: number }, { doubled: number }, { code: string }>(doubleContract.descriptor)
const Stamp = Action.fromDescriptor<{ value: number }, { stamped: number }, { code: string }>(stampContract.descriptor)

const childSource = `
import { durable } from "smithers:flows"
import { Double } from "test:child-actions"

throw new Error("the authored child Flow module must never execute")

export const DoubleFlow = durable(function DoubleFlow(input: { value: number }) {
  return Double.run({ value: input.value })
})
`

const childCompiled = compileDurableSource(childSource, {
  fileName: "flows/child-double.sm",
  flowId: "test/child/DoubleFlow",
  flowVersion: 1,
  actions: [{ moduleSpecifier: "test:child-actions", exportName: "Double", descriptor: Double.descriptor }]
})
if (!childCompiled.ok) throw new Error(JSON.stringify(childCompiled.diagnostics))

const parentSource = `
import { durable } from "smithers:flows"
import { DoubleFlow } from "test:child-flows"
import { Stamp } from "test:child-actions"

throw new Error("the authored parent Flow module must never execute")

export const Parent = durable(function Parent(input: { value: number }) {
  const doubled = DoubleFlow.run({ value: input.value })
  return Stamp.run({ value: doubled.doubled })
})
`

const compileParent = (text = parentSource) => compileDurableSource(text, {
  fileName: "flows/child-parent.sm",
  flowId: "test/child/Parent",
  flowVersion: 1,
  actions: [{ moduleSpecifier: "test:child-actions", exportName: "Stamp", descriptor: Stamp.descriptor }],
  flows: [{ moduleSpecifier: "test:child-flows", exportName: "DoubleFlow", plan: childCompiled.plan }]
})

const doubleCalls: number[] = []
const stampCalls: number[] = []

const deploymentFor = (
  plan: PlanTemplate,
  id: string,
  doubleImplementation?: ActionImplementation<{ value: number }, { doubled: number }>
) => Deployment.build({
  id,
  flow: PlanArtifact.load(PlanArtifact.encode(plan)),
  pools: [Worker.pool("child-worker", {
    target: "typescript-bun",
    providers: [
      Provider.provide(Double, doubleImplementation ?? (({ value }) => {
        doubleCalls.push(value)
        return { doubled: value * 2 }
      }), {
        implementationId: "child-double",
        implementationVersion: "1",
        recovery: { mode: "repeatable", maxAttempts: 3 }
      }),
      Provider.provide(Stamp, ({ value }) => {
        stampCalls.push(value)
        return { stamped: value + 100 }
      }, {
        implementationId: "child-stamp",
        implementationVersion: "1",
        recovery: { mode: "repeatable", maxAttempts: 3 }
      })
    ]
  })]
})

const resetCalls = (): void => {
  doubleCalls.length = 0
  stampCalls.length = 0
}

const childFlowNode = (plan: PlanTemplate): ChildFlowNode => {
  const node = plan.nodes.find((candidate) => candidate.kind === "childFlow")
  if (node?.kind !== "childFlow") throw new Error("expected a childFlow Plan node")
  return node
}

test("child Flow calls lower to a pinned, embedded format-2 boundary without evaluating source", () => {
  const compiled = compileParent()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.plan.formatVersion).toBe(2)
  expect(compiled.plan.nodes.map((node) => node.kind)).toEqual(["childFlow", "action"])
  const child = childFlowNode(compiled.plan)
  expect(child.flowId).toBe("test/child/DoubleFlow")
  expect(child.planDigest).toBe(childCompiled.plan.digest)
  expect(compiled.plan.childFlows).toHaveLength(1)
  expect(compiled.plan.childFlows![0]!.digest).toBe(childCompiled.plan.digest)
  // The parent closes the transitive Action requirement row.
  expect(compiled.plan.requirements).toEqual([Double.descriptor.id, Stamp.descriptor.id])
  const stampNode = compiled.plan.nodes[1]!
  expect(stampNode.dependencies).toEqual([child.id])
  expect(stampNode.controlDependencies).toEqual([child.id])
  // Success comes from the parent's final Action; the failure row unions the
  // child's reachable Action Errors with the parent's.
  expect(compiled.plan.flowSchemas?.success).toMatchObject({
    shape: "structural",
    descriptor: {
      kind: "object",
      fields: [{ name: "stamped", optional: false, value: { kind: "number" } }]
    }
  })
  expect(compiled.plan.flowSchemas?.error).toMatchObject({ shape: "structural", descriptor: { kind: "union" } })

  // Deterministic identity across unrelated leading edits.
  const shifted = compileParent(`// unrelated leading edit\n${parentSource}`)
  if (!shifted.ok) throw new Error(JSON.stringify(shifted.diagnostics))
  expect(shifted.plan.nodes.map((node) => node.id)).toEqual(compiled.plan.nodes.map((node) => node.id))

  // A wrong child input shape is a checker error before Plan emission.
  const wrongInput = compileParent(parentSource.replace(
    "DoubleFlow.run({ value: input.value })",
    "DoubleFlow.run({ wrong: true })"
  ))
  expect(wrongInput.ok).toBe(false)
  if (wrongInput.ok) throw new Error("expected child Flow input type failure")
  expect(wrongInput.diagnostics[0]!.code).toBe("SMITHERS4100")
})

test("a child executes as its own pinned attached execution and is adopted before exposure", async () => {
  const compiled = compileParent()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const node = childFlowNode(compiled.plan)
  const store = new DurableStore()
  resetCalls()
  const observedParentNodeStatus: string[] = []
  const deployment = deploymentFor(compiled.plan, "child-exec", ({ value }) => {
    // While the child runs, the parent childFlow node is suspended with no
    // attempt and no worker lease.
    observedParentNodeStatus.push(store.getNode("child-exec", node.id).status)
    doubleCalls.push(value)
    return { doubled: value * 2 }
  })
  try {
    const executor = new DurableExecutor(deployment, store)
    expect(await executor.execute({ value: 3 }, { executionId: "child-exec" })).toEqual({ stamped: 106 })
    expect(doubleCalls).toEqual([3])
    expect(stampCalls).toEqual([6])
    expect(observedParentNodeStatus).toEqual(["pending"])

    const childExecutionId = `child-exec::child::${node.id}`
    expect(store.listChildExecutions("child-exec")).toEqual([{
      nodeId: node.id,
      childExecutionId,
      planDigest: childCompiled.plan.digest
    }])
    // The child has its own pinned execution row and journal.
    expect(store.getExecution(childExecutionId).status).toBe("completed")
    const childJournal = store.journal(childExecutionId)
    expect(childJournal.some((event) => event.type === "execution_started")).toBe(true)
    expect(childJournal.some((event) => event.type === "execution_completed")).toBe(true)
    const started = childJournal.find((event) => event.type === "execution_started")!.payload as {
      readonly planDigest: string
    }
    expect(started.planDigest).toBe(childCompiled.plan.digest)
    expect(store.journal("child-exec").some((event) => event.type === "child_flow_linked")).toBe(true)

    // Replay returns journaled state without reinvoking either provider.
    expect(await executor.execute({ value: 3 }, { executionId: "child-exec" })).toEqual({ stamped: 106 })
    expect(doubleCalls).toEqual([3])
    expect(stampCalls).toEqual([6])
  } finally {
    store.close()
  }
})

const doubleContractErrorIdentity = (() => {
  const schema = Double.descriptor.errorSchema
  if (schema.shape !== "structural" || schema.descriptor.kind !== "error") {
    throw new Error("expected a nominal Error descriptor for Double")
  }
  return schema.descriptor.identity
})()

test("a child typed failure is adopted run-locally and fails the parent Flow", async () => {
  const compiled = compileParent()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const node = childFlowNode(compiled.plan)
  const store = new DurableStore()
  resetCalls()
  // The child's double provider raises its nominal typed Error.
  const failingDeployment = Deployment.build({
    id: "child-failure",
    flow: PlanArtifact.load(PlanArtifact.encode(compiled.plan)),
    pools: [Worker.pool("child-worker", {
      target: "typescript-bun",
      providers: [
        Provider.provide(Double, () => {
          doubleCalls.push(-1)
          return durableFail({
            version: 1,
            identity: doubleContractErrorIdentity,
            payload: { code: "child-boom" }
          }) as never
        }, {
          implementationId: "child-double-failing",
          implementationVersion: "1"
        }),
        Provider.provide(Stamp, ({ value }) => ({ stamped: value }), {
          implementationId: "child-stamp",
          implementationVersion: "1"
        })
      ]
    })]
  })
  try {
    const executor = new DurableExecutor(failingDeployment, store)
    let observed: unknown
    try {
      await executor.execute({ value: 9 }, { executionId: "child-failure" })
      throw new Error("expected the parent Flow to fail with the child's typed failure")
    } catch (error) {
      observed = error
    }
    expect(observed).toBeInstanceOf(DurableActionFailure)
    expect((observed as DurableActionFailure).nodeId).toBe(node.id)
    expect((observed as DurableActionFailure).failure).toMatchObject({ payload: { code: "child-boom" } })
    const childExecutionId = `child-failure::child::${node.id}`
    expect(store.getExecution(childExecutionId).status).toBe("failed")
    expect(store.getExecution("child-failure").status).toBe("failed")
    expect(store.getNode("child-failure", node.id).status).toBe("failed")
    expect(doubleCalls).toEqual([-1])
    expect(stampCalls).toEqual([])
  } finally {
    store.close()
  }
})

test("parent cancellation is recorded with child propagation, and completed children keep their outcome", async () => {
  const compiled = compileParent()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const node = childFlowNode(compiled.plan)
  const store = new DurableStore()
  resetCalls()
  let releaseObserver: (() => void) | undefined
  const blocking = new Promise<void>((resolve) => { releaseObserver = resolve })
  const deployment = deploymentFor(compiled.plan, "child-cancel", (_, context) =>
    new Promise((_resolve, reject) => {
      releaseObserver?.()
      const abort = (): void => reject(new Error("aborted by cancellation"))
      if (context.signal.aborted) return abort()
      context.signal.addEventListener("abort", abort, { once: true })
    }))
  try {
    const executor = new DurableExecutor(deployment, store)
    const running = executor.execute({ value: 5 }, { executionId: "child-cancel" })
    running.catch(() => {})
    await blocking
    const childExecutionId = `child-cancel::child::${node.id}`
    expect(store.getExecution(childExecutionId).status).toBe("running")
    executor.cancel("child-cancel", { name: "OperatorCancel", message: "stop" })
    await expect(running).rejects.toBeInstanceOf(DurableExecutionCancelled)
    // One durable transaction records parent cancellation and fences the
    // attached child, so no intermediate state leaves the child running.
    expect(store.getExecution("child-cancel").status).toBe("cancelled")
    expect(store.getExecution(childExecutionId).status).toBe("cancelled")
    expect(store.getNode("child-cancel", node.id).status).toBe("cancelled")
    expect(store.journal(childExecutionId).some((event) => event.type === "execution_cancelled")).toBe(true)
    expect(stampCalls).toEqual([])
  } finally {
    store.close()
  }

  // A child that already completed keeps its terminal outcome.
  const completedStore = new DurableStore()
  resetCalls()
  const completedDeployment = deploymentFor(compiled.plan, "child-cancel-late")
  try {
    const executor = new DurableExecutor(completedDeployment, completedStore)
    expect(await executor.execute({ value: 2 }, { executionId: "child-cancel-late" })).toEqual({ stamped: 104 })
    executor.cancel("child-cancel-late", { name: "TooLate", message: "already done" })
    const childExecutionId = `child-cancel-late::child::${node.id}`
    expect(completedStore.getExecution("child-cancel-late").status).toBe("completed")
    expect(completedStore.getExecution(childExecutionId).status).toBe("completed")
  } finally {
    completedStore.close()
  }
})

test("a parent that terminates inside the linkage window never lets its child start", async () => {
  const compiled = compileParent()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const node = childFlowNode(compiled.plan)

  // `registerChildExecution` COMMITs the link row and `initializeExecution`
  // COMMITs the child execution row in two different transactions.
  // `afterChildFlowLinked` is the documented seam between them, and it is the
  // whole window: `cancelDescendantExecutions` walks the link table and finds
  // no `durable_executions` row to fence, so before this was closed the child
  // ran its Actions to completion under a terminated parent — unrecoverably,
  // because re-cancelling an already-terminal parent is a no-op.
  for (const [label, terminate] of [
    ["cancelled", (store: DurableStore, executor: DurableExecutor<{ value: number }, unknown>, id: string) => {
      executor.cancel(id, { name: "OperatorCancel", message: "stop" })
    }],
    // `failExecution` reaches the identical helper through the identical
    // `if (update.changes === 1)` guard, so it has the identical window.
    ["failed", (store: DurableStore, _executor: DurableExecutor<{ value: number }, unknown>, id: string) => {
      store.failExecution(id, "defect", { name: "OperatorDefect", message: "stop" })
    }]
  ] as const) {
    const executionId = `child-window-${label}`
    const childExecutionId = `${executionId}::child::${node.id}`
    const store = new DurableStore()
    resetCalls()
    const executor = new DurableExecutor(deploymentFor(compiled.plan, executionId), store)
    try {
      const running = executor.execute({ value: 11 }, {
        executionId,
        afterChildFlowLinked(linkedNodeId, linkedChildId) {
          expect(linkedNodeId).toBe(node.id)
          expect(linkedChildId).toBe(childExecutionId)
          // The link is committed and the child execution row does not exist.
          expect(store.listChildExecutions(executionId)).toHaveLength(1)
          expect(() => store.getExecution(childExecutionId)).toThrow(/Unknown durable execution/)
          terminate(store, executor, executionId)
        }
      })
      await expect(running).rejects.toBeInstanceOf(Error)
      expect(store.getExecution(executionId).status).toBe(label)
      // The child was never created, so no Action of it ever ran and there is
      // no execution left behind that nothing can cancel.
      expect(() => store.getExecution(childExecutionId)).toThrow(/Unknown durable execution/)
      expect(store.journal(childExecutionId)).toEqual([])
      expect(doubleCalls).toEqual([])
      expect(stampCalls).toEqual([])
    } finally {
      store.close()
    }
  }

  // BOTH DIRECTIONS: the guard is on a terminated parent, not on being a child.
  // An ordinary attached child still starts, runs, and completes, and a nested
  // grandchild still starts under it.
  const store = new DurableStore()
  resetCalls()
  try {
    expect(await new DurableExecutor(deploymentFor(compiled.plan, "child-window-ok"), store)
      .execute({ value: 4 }, { executionId: "child-window-ok" })).toEqual({ stamped: 108 })
    expect(doubleCalls).toEqual([4])
    expect(store.getExecution(`child-window-ok::child::${node.id}`).status).toBe("completed")
  } finally {
    store.close()
  }
})

type StoreCommitPoint = "registerChildExecution" | "completeExecution"

const crashAfterCommit = (
  store: DurableStore,
  point: StoreCommitPoint,
  committed: (result: unknown) => boolean = () => true
): DurableStore => {
  let armed = true
  return new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property, target)
      if (typeof value !== "function") return value
      return (...args: unknown[]) => {
        const result = Reflect.apply(value, target, args)
        if (armed && property === point && committed(result)) {
          armed = false
          throw new CoordinatorCrash(point)
        }
        return result
      }
    }
  })
}

test("crashes after linkage, child completion, and parent adoption all resume without reinvocation", async () => {
  const compiled = compileParent()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const node = childFlowNode(compiled.plan)
  const deployment = deploymentFor(compiled.plan, "child-crash")
  const childExecutionId = `child-crash::child::${node.id}`
  const directory = mkdtempSync(join(tmpdir(), "smithers-child-flow-"))
  const database = join(directory, "durable.sqlite")
  resetCalls()
  try {
    // Crash immediately after the durable child linkage commit.
    const linkStore = new DurableStore(database)
    try {
      await expect(new DurableExecutor(
        deployment,
        crashAfterCommit(linkStore, "registerChildExecution", (result) =>
          (result as { newlyLinked: boolean }).newlyLinked)
      ).execute({ value: 4 }, { executionId: "child-crash" })).rejects.toBeInstanceOf(CoordinatorCrash)
      expect(doubleCalls).toEqual([])
    } finally {
      linkStore.close()
    }

    // Crash immediately after the CHILD execution's terminal commit, before
    // the parent adopts the outcome.
    const childCompleteStore = new DurableStore(database)
    try {
      await expect(new DurableExecutor(
        deployment,
        crashAfterCommit(childCompleteStore, "completeExecution", (result) => {
          const finish = result as { changed: boolean; execution: { id: string } }
          return finish.changed && finish.execution.id === childExecutionId
        })
      ).execute({ value: 4 }, { executionId: "child-crash" })).rejects.toBeInstanceOf(CoordinatorCrash)
      expect(doubleCalls).toEqual([4])
      expect(childCompleteStore.getExecution(childExecutionId).status).toBe("completed")
      expect(childCompleteStore.getNode("child-crash", node.id).status).toBe("pending")
    } finally {
      childCompleteStore.close()
    }

    // Crash immediately after the parent's run-local adoption commit.
    const adoptStore = new DurableStore(database)
    try {
      await expect(new DurableExecutor(deployment, adoptStore).execute({ value: 4 }, {
        executionId: "child-crash",
        afterNodeAdopted: (nodeId) => {
          if (nodeId === node.id) throw new CoordinatorCrash(nodeId)
        }
      })).rejects.toBeInstanceOf(CoordinatorCrash)
      expect(doubleCalls).toEqual([4])
      expect(adoptStore.getNode("child-crash", node.id).status).toBe("succeeded")
    } finally {
      adoptStore.close()
    }

    const resumedStore = new DurableStore(database)
    try {
      expect(await new DurableExecutor(deployment, resumedStore).execute({ value: 4 }, {
        executionId: "child-crash"
      })).toEqual({ stamped: 108 })
      expect(doubleCalls).toEqual([4])
      expect(stampCalls).toEqual([8])
      expect(resumedStore.journal("child-crash")
        .filter((event) => event.type === "child_flow_linked")).toHaveLength(1)
    } finally {
      resumedStore.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("two independent connections converge on one attached child execution", async () => {
  const compiled = compileParent()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const node = childFlowNode(compiled.plan)
  const deployment = deploymentFor(compiled.plan, "child-race")
  const directory = mkdtempSync(join(tmpdir(), "smithers-child-flow-race-"))
  const database = join(directory, "durable.sqlite")
  resetCalls()
  const storeA = new DurableStore(database)
  const storeB = new DurableStore(database)
  try {
    const [first, second] = await Promise.all([
      new DurableExecutor(deployment, storeA).execute({ value: 7 }, { executionId: "child-race" }),
      new DurableExecutor(deployment, storeB).execute({ value: 7 }, { executionId: "child-race" })
    ])
    expect(first).toEqual({ stamped: 114 })
    expect(second).toEqual({ stamped: 114 })
    expect(doubleCalls).toEqual([7])
    expect(stampCalls).toEqual([14])
    expect(storeA.listChildExecutions("child-race")).toHaveLength(1)
    expect(storeA.journal("child-race").filter((event) => event.type === "child_flow_linked")).toHaveLength(1)
    expect(storeA.getExecution(`child-race::child::${node.id}`).status).toBe("completed")
  } finally {
    storeA.close()
    storeB.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("nested child chains execute as attached executions and stop at the round budget", async () => {
  const chain: PlanTemplate[] = [childCompiled.plan]
  for (let level = 2; level <= 8; level++) {
    const compiled = compileDurableSource(`
import { durable } from "smithers:flows"
import { Prev } from "test:chain"
export const Chain${level} = durable(function Chain${level}(input: { value: number }) {
  return Prev.run({ value: input.value })
})
`, {
      fileName: `flows/chain-${level}.sm`,
      flowId: `test/chain/${level}`,
      flowVersion: 1,
      actions: [],
      flows: [{ moduleSpecifier: "test:chain", exportName: "Prev", plan: chain[chain.length - 1]! }]
    })
    if (!compiled.ok) throw new Error(`chain level ${level}: ${JSON.stringify(compiled.diagnostics)}`)
    expect(compiled.plan.formatVersion).toBe(2)
    chain.push(compiled.plan)
  }
  // The ninth level exceeds the child-boundary round budget and fails closed.
  const overBudget = compileDurableSource(`
import { durable } from "smithers:flows"
import { Prev } from "test:chain"
export const Chain9 = durable(function Chain9(input: { value: number }) {
  return Prev.run({ value: input.value })
})
`, {
    fileName: "flows/chain-9.sm",
    flowId: "test/chain/9",
    flowVersion: 1,
    actions: [],
    flows: [{ moduleSpecifier: "test:chain", exportName: "Prev", plan: chain[chain.length - 1]! }]
  })
  expect(overBudget.ok).toBe(false)
  if (overBudget.ok) throw new Error("expected the round budget to fail closed")
  expect(overBudget.diagnostics[0]!.code).toBe("SMITHERS4120")
  expect(overBudget.diagnostics[0]!.message).toContain("round budget")

  // A three-level chain runs as three attached executions.
  const level3 = chain[2]!
  const deployment = deploymentFor(level3, "chain-exec")
  const store = new DurableStore()
  resetCalls()
  try {
    expect(await new DurableExecutor(deployment, store).execute({ value: 6 }, {
      executionId: "chain-exec"
    })).toEqual({ doubled: 12 })
    expect(doubleCalls).toEqual([6])
    const level2Children = store.listChildExecutions("chain-exec")
    expect(level2Children).toHaveLength(1)
    const level1Children = store.listChildExecutions(level2Children[0]!.childExecutionId)
    expect(level1Children).toHaveLength(1)
    expect(store.getExecution(level1Children[0]!.childExecutionId).status).toBe("completed")
    expect(store.getExecution(level2Children[0]!.childExecutionId).status).toBe("completed")
  } finally {
    store.close()
  }
})

test("forged child Flow artifacts and store linkages fail closed", async () => {
  const compiled = compileParent()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))

  // Downgrading the format version cannot smuggle a childFlow node into v1.
  const downgraded = JSON.parse(JSON.stringify(compiled.plan))
  downgraded.formatVersion = 1
  const { digest: _downgraded, ...downgradedSemantic } = downgraded
  expect(() => validatePlanTemplate({ ...downgradedSemantic, digest: digest(downgradedSemantic) }))
    .toThrow("require Plan format version 2")

  // A childFlow node must reference an embedded, digest-pinned Plan.
  const unpinned = JSON.parse(JSON.stringify(compiled.plan))
  unpinned.nodes[0].planDigest = digest({ forged: true })
  const { digest: _unpinned, ...unpinnedSemantic } = unpinned
  expect(() => validatePlanTemplate({ ...unpinnedSemantic, digest: digest(unpinnedSemantic) }))
    .toThrow("absent from childFlows")

  // Tampering with the embedded child breaks its own pinned digest.
  const tampered = JSON.parse(JSON.stringify(compiled.plan))
  tampered.childFlows[0].flowVersion = 99
  const { digest: _tampered, ...tamperedSemantic } = tampered
  expect(() => validatePlanTemplate({ ...tamperedSemantic, digest: digest(tamperedSemantic) }))
    .toThrow("digest mismatch")

  // An embedded Plan no node references is rejected.
  const extraChild = compileDurableSource(childSource, {
    fileName: "flows/child-double.sm",
    flowId: "test/child/DoubleFlow",
    flowVersion: 2,
    actions: [{ moduleSpecifier: "test:child-actions", exportName: "Double", descriptor: Double.descriptor }]
  })
  if (!extraChild.ok) throw new Error(JSON.stringify(extraChild.diagnostics))
  const smuggled = JSON.parse(JSON.stringify(compiled.plan))
  smuggled.childFlows = [...smuggled.childFlows, JSON.parse(JSON.stringify(extraChild.plan))]
    .sort((left, right) => left.digest < right.digest ? -1 : 1)
  const { digest: _smuggled, ...smuggledSemantic } = smuggled
  expect(() => validatePlanTemplate({ ...smuggledSemantic, digest: digest(smuggledSemantic) }))
    .toThrow("not referenced by any childFlow node")

  // Store linkage is exact: one node, one child identity, one Plan digest.
  const node = childFlowNode(compiled.plan)
  const deployment = deploymentFor(compiled.plan, "child-forged-link")
  const store = new DurableStore()
  resetCalls()
  try {
    await new DurableExecutor(deployment, store).execute({ value: 1 }, { executionId: "child-forged-link" })
    expect(() => store.registerChildExecution(
      "child-forged-link",
      node.id,
      "child-forged-link::child::other",
      childCompiled.plan.digest
    )).toThrow(ContentIntegrityError)
    const stampNode = compiled.plan.nodes[1]!
    expect(() => store.registerChildExecution(
      "child-forged-link",
      stampNode.id,
      "child-forged-link::child::stamp",
      childCompiled.plan.digest
    )).toThrow("Unknown durable childFlow node")
  } finally {
    store.close()
  }
})

// The attached-child execution id NAMESPACE.
//
// `./engine.ts` derives an attached child's execution id as
// `parent + '::child::' + nodeId`, and that derived id is the PRIMARY KEY of
// `durable_executions`. An execution id is otherwise caller-chosen and only
// bounded, so the derived namespace and the caller's namespace overlapped: a
// caller could take the row a Flow was going to derive.
//
// WHY A DIFFERENTIAL TEST COULD NOT HAVE FOUND THIS. The durable engine and
// store are reference-only; the Go fork carries the durable CONTRACT compiler
// and no runtime, so there is no second backend to disagree. The assertion is
// direct.
//
// RED BEFORE THE FIX: `initializeExecution` accepted the derived id from an
// unlinked caller, and the parent Flow that later reached its childFlow node
// then threw `Execution child-namespace::child::<node> is pinned to different
// input, Plan IR, schemas, or deployment manifest` — permanently, because a
// parent cannot recover from being unable to create its child.
test("a caller cannot claim an execution id in the derived attached-child namespace", async () => {
  const compiled = compileParent()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const node = childFlowNode(compiled.plan)
  const deployment = deploymentFor(compiled.plan, "child-namespace")
  const store = new DurableStore()
  resetCalls()
  try {
    const derived = `child-namespace::child::${node.id}`
    // The hijack, refused before any row exists.
    expect(() => store.initializeExecution(derived, compiled.plan, deployment.manifest, { value: 1 }))
      .toThrow("reserved attached-child namespace")
    // Any unlinked id in the namespace is refused, not just one a real parent
    // would derive — the guard is the LINK, not a guess about the spelling.
    expect(() => store.initializeExecution("nobody::child::anything", compiled.plan, deployment.manifest, { value: 1 }))
      .toThrow("reserved attached-child namespace")
    // An id outside the namespace is untouched.
    const ordinary = store.initializeExecution("child-namespace-ordinary", compiled.plan, deployment.manifest, { value: 1 })
    expect(ordinary.status).toBe("running")

    // And the legitimate attached child still gets its row: the parent links it
    // through `registerChildExecution` before creating it, so the link exists.
    const executor = new DurableExecutor(deployment, store)
    expect(await executor.execute({ value: 3 }, { executionId: "child-namespace" })).toEqual({ stamped: 106 })
    expect(store.getExecution(derived).status).toBe("completed")
  } finally {
    store.close()
  }
})
