import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  CoordinatorCrash,
  compileDurableSource,
  Deployment,
  digest,
  DurableActionDefect,
  DurableExecutionCancelled,
  DurableExecutor,
  DurableStore,
  PlanArtifact,
  type JsonValue,
  type PlanNode,
  type ValueExpr
} from "./index.ts"

const timerFixture = <Input = Record<string, never>>(
  durationMs: ValueExpr = { kind: "literal", value: 40 },
  suffix = "timer"
) => {
  const nodeId = `stable-${suffix}-timer`
  const node: Extract<PlanNode, { readonly kind: "timer" }> = {
    kind: "timer",
    id: nodeId,
    durationMs,
    dependencies: [],
    controlDependencies: [],
    debug: { label: "sleep" }
  }
  const semantic = {
    formatVersion: 1 as const,
    flowId: `test/Timer/${suffix}`,
    flowVersion: 1,
    nodes: [node],
    output: { kind: "node" as const, nodeId, path: [] as readonly string[] },
    requirements: [] as readonly string[],
    actions: [] as const
  }
  const plan = PlanArtifact.validate({ ...semantic, digest: digest(semantic) })
  const flow = PlanArtifact.load<Input, null>(PlanArtifact.encode(plan))
  return {
    nodeId,
    flow,
    deployment: Deployment.build({ id: `timer-${suffix}`, flow, pools: [] })
  }
}

const invalidPlan = (node: unknown): unknown => {
  const semantic = {
    formatVersion: 1,
    flowId: "test/Timer/Invalid",
    flowVersion: 1,
    nodes: [node],
    output: { kind: "literal", value: null },
    requirements: [],
    actions: []
  }
  return { ...semantic, digest: digest(semantic) }
}

const timerNode = (durationMs: unknown, extra: Record<string, unknown> = {}): unknown => ({
  kind: "timer",
  id: "timer-node",
  durationMs,
  dependencies: [],
  controlDependencies: [],
  ...extra
})

const timerEvents = (store: DurableStore, executionId: string) =>
  store.journal(executionId).filter((event) => event.type === "timer_scheduled")

test("timer artifacts are exact and unsupported durable coordination fails closed", () => {
  expect(timerFixture().flow.plan.nodes[0].kind).toBe("timer")

  expect(() => PlanArtifact.validate(invalidPlan(timerNode(
    { kind: "literal", value: 1 },
    { hiddenSemantics: true }
  )))).toThrow("unknown field hiddenSemantics")
  expect(() => PlanArtifact.validate(invalidPlan(timerNode(
    { kind: "node", nodeId: "prior", path: [] }
  )))).toThrow("dependency list does not match expressions")
  expect(() => PlanArtifact.validate(invalidPlan(timerNode(
    { kind: "literal", value: -1 }
  )))).toThrow("non-negative safe integer")
  expect(() => PlanArtifact.validate(invalidPlan(timerNode(
    { kind: "literal", value: 1.5 }
  )))).toThrow("non-negative safe integer")

  for (const kind of ["child", "compensation"] as const) {
    expect(() => PlanArtifact.validate(invalidPlan({
      kind,
      id: `${kind}-node`,
      dependencies: [],
      controlDependencies: []
    }))).toThrow(`unsupported Plan node ${kind}`)
  }
  // Format-version-2 coordination cannot be smuggled into a version-1 Plan.
  for (const kind of ["loop", "childFlow"] as const) {
    expect(() => PlanArtifact.validate(invalidPlan({
      kind,
      id: `${kind}-node`,
      dependencies: [],
      controlDependencies: []
    }))).toThrow("require Plan format version 2")
  }
})

test("compiler-owned sleep lowers statically with stable identity and executes without author-module evaluation", async () => {
  const source = `
import { durable as compileFlow, sleep as nap } from "vibelang:flows"

throw new Error("the authored module must never execute during lowering")

export const Pause = compileFlow(function Pause(input: { first: number; second: number }) {
  nap(input.first)
  nap(input.second)
  return { done: true }
})
`
  const compile = (text: string) => compileDurableSource(text, {
    fileName: "flows/pause.vibe.ts",
    flowId: "test/source/Pause",
    flowVersion: 1,
    actions: []
  })
  const result = compile(source)
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  expect(result.plan.nodes.map((node) => node.kind)).toEqual(["timer", "timer"])
  const [first, second] = result.plan.nodes
  expect(second.controlDependencies).toEqual([first.id])

  const withUnrelatedLeadingEdit = compile(`// unrelated banner\n${source}`)
  if (!withUnrelatedLeadingEdit.ok) throw new Error(JSON.stringify(withUnrelatedLeadingEdit.diagnostics))
  expect(withUnrelatedLeadingEdit.plan.nodes.map((node) => node.id)).toEqual(
    result.plan.nodes.map((node) => node.id)
  )

  const deployment = Deployment.build({ id: "source-timer", flow: result.flow, pools: [] })
  const store = new DurableStore()
  try {
    expect(await new DurableExecutor(deployment, store).execute(
      { first: 5, second: 5 },
      { executionId: "source-timer" }
    )).toEqual({ done: true })
    expect(timerEvents(store, "source-timer")).toHaveLength(2)
  } finally {
    store.close()
  }
})

test("sleep recognition follows compiler symbol identity and unsupported suspension forms fail closed", () => {
  const compile = (source: string) => compileDurableSource(source, {
    fileName: "flows/suspension.vibe.ts",
    flowId: "test/source/Suspension",
    flowVersion: 1,
    actions: []
  })
  const namespace = compile(`
import * as Flows from "vibelang:flows"
export const Pause = Flows.durable(function Pause(input: { delay: number }) {
  Flows.sleep(input.delay)
  return null
})
`)
  if (!namespace.ok) throw new Error(JSON.stringify(namespace.diagnostics))
  expect(namespace.plan.nodes[0].kind).toBe("timer")

  const localSpoof = compile(`
import { durable, sleep as compilerSleep } from "vibelang:flows"
function sleep(_duration: number) { return null }
export const Pause = durable(function Pause(input: { delay: number }) {
  sleep(input.delay)
  return null
})
void compilerSleep
`)
  expect(localSpoof.ok).toBe(false)
  if (localSpoof.ok) throw new Error("expected local sleep spoof to fail")
  expect(localSpoof.diagnostics[0].code).toBe("VIBE4108")

  const optional = compile(`
import { durable, sleep } from "vibelang:flows"
export const Pause = durable(function Pause(_input: {}) {
  sleep?.(1)
  return null
})
`)
  expect(optional.ok).toBe(false)
  if (optional.ok) throw new Error("expected optional sleep to fail")
  expect(optional.diagnostics[0].code).toBe("VIBE4116")

  const invalidLiteral = compile(`
import { durable, sleep } from "vibelang:flows"
export const Pause = durable(function Pause(_input: {}) {
  sleep(-1)
  return null
})
`)
  expect(invalidLiteral.ok).toBe(false)
  if (invalidLiteral.ok) throw new Error("expected invalid sleep duration to fail")
  expect(invalidLiteral.diagnostics[0].code).toBe("VIBE4116")

  for (const call of ["waitForSignal(\"ready\")", "spawnChild(\"flow\")"] as const) {
    const unsupported = compile(`
import { durable } from "vibelang:flows"
declare function waitForSignal(name: string): void
declare function spawnChild(name: string): void
export const Pause = durable(function Pause(_input: {}) {
  ${call}
  return null
})
`)
    expect(unsupported.ok).toBe(false)
    if (unsupported.ok) throw new Error(`expected ${call} to fail`)
    expect(unsupported.diagnostics[0].code).toBe("VIBE4108")
  }

  const loop = compile(`
import { durable, sleep } from "vibelang:flows"
export const Pause = durable(function Pause(input: { count: number }) {
  for (let index = 0; index < input.count; index += 1) sleep(1)
  return null
})
`)
  expect(loop.ok).toBe(false)
  if (loop.ok) throw new Error("expected timer loop to fail")
  expect(loop.diagnostics[0].code).toBe("VIBE4107")
})

test("the store persists one wake deadline and rejects early or unscheduled claims", () => {
  const { deployment, nodeId } = timerFixture({ kind: "literal", value: 50 }, "store-gate")
  const store = new DurableStore()
  try {
    store.initializeExecution(
      "store-gate",
      deployment.flow.plan,
      deployment.manifest,
      {},
      Date.now() + 10_000
    )
    expect(() => store.claimNode("store-gate", nodeId, "worker", 100, 100)).toThrow(
      "must be scheduled before it can be claimed"
    )
    const scheduled = store.scheduleTimer("store-gate", nodeId, 50, 100)
    expect(scheduled).toEqual({ kind: "waiting", wakeAt: 150, newlyScheduled: true })
    expect(store.scheduleTimer("store-gate", nodeId, 999, 101)).toEqual({
      kind: "waiting",
      wakeAt: 150,
      newlyScheduled: false
    })
    expect(store.getNode("store-gate", nodeId).wakeAt).toBe(150)
    expect(store.claimNode("store-gate", nodeId, "worker", 100, 149)).toEqual({
      kind: "busy",
      leaseExpiresAt: 150
    })
    const claim = store.claimNode("store-gate", nodeId, "worker", 100, 150)
    expect(claim.kind).toBe("claimed")
    if (claim.kind !== "claimed") throw new Error("expected due timer claim")
    expect(store.getNode("store-gate", nodeId).wakeAt).toBe(150)
    expect(store.claimNode("store-gate", nodeId, "rollback-worker", 100, 149)).toEqual({
      kind: "busy",
      leaseExpiresAt: 150
    })
    expect(store.commitSuccess("store-gate", nodeId, "worker", claim.fencingToken, null)).toBe(true)
    expect(store.getNode("store-gate", nodeId)).toEqual({
      status: "succeeded",
      exit: { kind: "success", value: null, adoptedFrom: null }
    })
    expect(timerEvents(store, "store-gate")).toHaveLength(1)
  } finally {
    store.close()
  }
})

test("a timer never completes before its persisted wake time and completed replay does not sleep", async () => {
  const durationMs = 70
  const { deployment, nodeId } = timerFixture({ kind: "literal", value: durationMs }, "no-early")
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    expect(await executor.execute({}, { executionId: "no-early" })).toBeNull()
    const scheduled = timerEvents(store, "no-early")
    const succeeded = store.journal("no-early").filter((event) =>
      event.nodeId === nodeId && event.type === "node_succeeded")
    expect(scheduled).toHaveLength(1)
    expect(succeeded).toHaveLength(1)
    const payload = scheduled[0].payload as { readonly durationMs: number; readonly wakeAt: number }
    expect(payload.durationMs).toBe(durationMs)
    expect(succeeded[0].timestamp).toBeGreaterThanOrEqual(payload.wakeAt)

    const beforeReplay = store.journal("no-early")
    expect(await executor.execute({}, { executionId: "no-early" })).toBeNull()
    expect(store.journal("no-early")).toEqual(beforeReplay)
  } finally {
    store.close()
  }
})

test("restart after scheduling reuses the exact persisted deadline", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vibe-timer-restart-"))
  const filename = join(directory, "state.sqlite")
  const { deployment, nodeId } = timerFixture({ kind: "literal", value: 140 }, "restart")
  let wakeAt = 0
  const firstStore = new DurableStore(filename)
  try {
    await expect(new DurableExecutor(deployment, firstStore).execute({}, {
      executionId: "restart",
      afterTimerScheduled: (scheduledNodeId, scheduledWakeAt) => {
        expect(scheduledNodeId).toBe(nodeId)
        wakeAt = scheduledWakeAt
        throw new CoordinatorCrash(scheduledNodeId)
      }
    })).rejects.toBeInstanceOf(CoordinatorCrash)
    expect(firstStore.getNode("restart", nodeId)).toEqual({ status: "pending", wakeAt })
    expect(timerEvents(firstStore, "restart")).toHaveLength(1)
  } finally {
    firstStore.close()
  }

  const resumedStore = new DurableStore(filename)
  try {
    expect(await new DurableExecutor(deployment, resumedStore).execute(
      {},
      { executionId: "restart" }
    )).toBeNull()
    expect(Date.now()).toBeGreaterThanOrEqual(wakeAt)
    expect(timerEvents(resumedStore, "restart")).toHaveLength(1)
    expect(resumedStore.getNode("restart", nodeId).status).toBe("succeeded")
  } finally {
    resumedStore.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("restart after timer completion exposes the committed result without rescheduling", async () => {
  const { deployment, nodeId } = timerFixture({ kind: "literal", value: 10 }, "adopted")
  const store = new DurableStore()
  try {
    await expect(new DurableExecutor(deployment, store).execute({}, {
      executionId: "adopted",
      afterNodeAdopted: (adoptedNodeId) => {
        if (adoptedNodeId === nodeId) throw new CoordinatorCrash(adoptedNodeId)
      }
    })).rejects.toBeInstanceOf(CoordinatorCrash)
    expect(store.getExecution("adopted").status).toBe("running")
    expect(store.getNode("adopted", nodeId).status).toBe("succeeded")

    expect(await new DurableExecutor(deployment, store).execute(
      {},
      { executionId: "adopted" }
    )).toBeNull()
    expect(timerEvents(store, "adopted")).toHaveLength(1)
  } finally {
    store.close()
  }
})

test("cancellation interrupts a suspended timer and fences its wake state", async () => {
  const { deployment, nodeId } = timerFixture({ kind: "literal", value: 1_000 }, "cancel")
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    let scheduledResolve!: () => void
    const scheduled = new Promise<void>((resolve) => { scheduledResolve = resolve })
    const execution = executor.execute({}, {
      executionId: "cancel",
      afterTimerScheduled: () => { scheduledResolve() }
    })
    await scheduled
    const cancelledAt = Date.now()
    executor.cancel("cancel", { name: "UserCancelled" })
    await expect(execution).rejects.toBeInstanceOf(DurableExecutionCancelled)
    expect(Date.now() - cancelledAt).toBeLessThan(250)
    expect(store.getNode("cancel", nodeId)).toEqual({
      status: "cancelled",
      exit: { kind: "cancelled", reason: { name: "UserCancelled" } }
    })
    expect(store.journal("cancel").some((event) => event.type === "node_succeeded")).toBe(false)
  } finally {
    store.close()
  }
})

test("execution deadline wins over a later timer wake and dynamic bad durations defect", async () => {
  const timeoutFixture = timerFixture({ kind: "literal", value: 1_000 }, "timeout")
  const timeoutStore = new DurableStore()
  try {
    const started = Date.now()
    await expect(new DurableExecutor(timeoutFixture.deployment, timeoutStore).execute({}, {
      executionId: "timeout",
      deadline: started + 70
    })).rejects.toBeInstanceOf(DurableActionDefect)
    expect(Date.now() - started).toBeLessThan(500)
    expect(timeoutStore.getNode("timeout", timeoutFixture.nodeId).status).toBe("defect")
    expect(timeoutStore.journal("timeout").some((event) => event.type === "node_succeeded")).toBe(false)
  } finally {
    timeoutStore.close()
  }

  const dynamicFixture = timerFixture<{ durationMs: JsonValue }>(
    { kind: "input", path: ["durationMs"] },
    "dynamic-invalid"
  )
  const dynamicStore = new DurableStore()
  try {
    try {
      await new DurableExecutor(dynamicFixture.deployment, dynamicStore).execute(
        { durationMs: -1 },
        { executionId: "dynamic-invalid" }
      )
      throw new Error("expected timer duration defect")
    } catch (error) {
      expect(error).toBeInstanceOf(DurableActionDefect)
      expect((error as DurableActionDefect).defect).toEqual({
        _tag: "TimerDurationDefect",
        expected: "non-negative safe integer milliseconds",
        value: -1
      })
    }
    expect(timerEvents(dynamicStore, "dynamic-invalid")).toHaveLength(0)
  } finally {
    dynamicStore.close()
  }
})
