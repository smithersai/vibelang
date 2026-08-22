import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  allPlanNodes,
  compileDurableSource,
  Deployment,
  digest,
  DurableExecutionCancelled,
  DurableExecutor,
  DurableStore,
  PlanArtifact,
  WakeupService,
  type PlanNode,
  type SignalNode
} from "./index.ts"

const approvalSource = `
import { durable, waitSignal } from "vibelang:flows"

export const Approval = durable(function Approval(input: { requestId: string }) {
  const decision = waitSignal<{ approved: boolean; ticket: string }>("approval.decided")
  return { requestId: input.requestId, decision: decision }
})
`

const signalFixture = () => {
  const compiled = compileDurableSource(approvalSource, {
    fileName: "flows/wakeup-approval.vibe.ts",
    flowId: "test/wakeup/Approval",
    flowVersion: 1,
    actions: []
  })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const node = allPlanNodes(compiled.plan).find((candidate): candidate is SignalNode => candidate.kind === "signal")
  if (node === undefined) throw new Error("expected signal Plan node")
  return {
    node,
    deployment: Deployment.build({ id: "wakeup-signal", flow: compiled.flow, pools: [] })
  }
}

const timerFixture = (durationMs: number, suffix: string) => {
  const nodeId = `wakeup-${suffix}-timer`
  const node: Extract<PlanNode, { readonly kind: "timer" }> = {
    kind: "timer",
    id: nodeId,
    durationMs: { kind: "literal", value: durationMs },
    dependencies: [],
    controlDependencies: [],
    debug: { label: "sleep" }
  }
  const semantic = {
    formatVersion: 1 as const,
    flowId: `test/WakeupTimer/${suffix}`,
    flowVersion: 1,
    nodes: [node],
    output: { kind: "node" as const, nodeId, path: [] as readonly string[] },
    requirements: [] as readonly string[],
    actions: [] as const
  }
  const plan = PlanArtifact.validate({ ...semantic, digest: digest(semantic) })
  const flow = PlanArtifact.load<Record<string, never>, null>(PlanArtifact.encode(plan))
  return {
    nodeId,
    deployment: Deployment.build({ id: `wakeup-timer-${suffix}`, flow, pools: [] })
  }
}

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(5)
  }
}

test("a same-process delivery wakes a suspended signal wait far ahead of the sweep", async () => {
  const { deployment, node } = signalFixture()
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    // The sweep is a full minute: only the in-process notification fast path
    // can complete this execution quickly.
    const handle = executor.start({ requestId: "fast" }, {
      executionId: "fast-path",
      deadline: Date.now() + 120_000,
      wakeupSweepMs: 60_000
    })
    await waitFor(
      () => store.journal("fast-path").some((event) => event.type === "signal_waiting"),
      "fast-path suspension"
    )
    const delivered = Date.now()
    handle.signal(node.signalId, {
      idempotencyKey: "event-1",
      payload: { approved: true, ticket: "T-1" }
    })
    expect(await handle.result()).toEqual({
      requestId: "fast",
      decision: { approved: true, ticket: "T-1" }
    })
    expect(Date.now() - delivered).toBeLessThan(10_000)
  } finally {
    store.close()
  }
})

test("a delivery through another connection is observed at the sweep boundary without any notification", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vibelang-wakeup-sweep-"))
  const filename = join(directory, "durable.sqlite")
  const { deployment, node } = signalFixture()
  const storeA = new DurableStore(filename)
  const storeB = new DurableStore(filename)
  try {
    const coordinator = new DurableExecutor(deployment, storeA)
    const sender = new DurableExecutor(deployment, storeB)
    const handle = coordinator.start({ requestId: "sweep" }, {
      executionId: "sweep-path",
      deadline: Date.now() + 60_000,
      wakeupSweepMs: 250
    })
    await waitFor(
      () => storeA.journal("sweep-path").some((event) => event.type === "signal_waiting"),
      "sweep-path suspension"
    )
    // Delivery commits through connection B. Connection A's in-process
    // notifier never fires — separate WakeupService instances — so only the
    // fallback sweep can wake the waiting coordinator.
    const grant = sender.grantSignal("sweep-path", node.signalId)
    sender.deliverSignal({
      executionId: "sweep-path",
      nodeId: grant.nodeId,
      signalId: node.signalId,
      idempotencyKey: "event-1",
      payload: { approved: false, ticket: "T-7" }
    }, { senderToken: grant.senderToken })
    const delivered = Date.now()
    expect(await handle.result()).toEqual({
      requestId: "sweep",
      decision: { approved: false, ticket: "T-7" }
    })
    expect(Date.now() - delivered).toBeLessThan(10_000)
    expect(storeA.journal("sweep-path").filter((event) => event.type === "signal_consumed")).toHaveLength(1)
  } finally {
    storeA.close()
    storeB.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("a suspended timer sleeps to its exact persisted wake time rather than a poll or sweep interval", async () => {
  const { deployment, nodeId } = timerFixture(150, "exact")
  const store = new DurableStore()
  try {
    const started = Date.now()
    // With a one-minute sweep, completing shortly after wake_at proves the
    // wait targeted the exact persisted deadline rather than any interval.
    expect(await new DurableExecutor(deployment, store).execute({}, {
      executionId: "exact-timer",
      deadline: Date.now() + 120_000,
      wakeupSweepMs: 60_000
    })).toBeNull()
    const elapsed = Date.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(150)
    expect(elapsed).toBeLessThan(10_000)
    const scheduled = store.journal("exact-timer").find((event) => event.type === "timer_scheduled")
    const succeeded = store.journal("exact-timer").find((event) =>
      event.nodeId === nodeId && event.type === "node_succeeded")
    expect(succeeded!.timestamp).toBeGreaterThanOrEqual(
      (scheduled!.payload as { readonly wakeAt: number }).wakeAt
    )
  } finally {
    store.close()
  }
})

test("cross-connection cancellation interrupts a long timer wait at the sweep boundary", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vibelang-wakeup-cancel-"))
  const filename = join(directory, "durable.sqlite")
  const { deployment, nodeId } = timerFixture(30_000, "cancel")
  const storeA = new DurableStore(filename)
  const storeB = new DurableStore(filename)
  try {
    let scheduledResolve!: () => void
    const scheduled = new Promise<void>((resolve) => { scheduledResolve = resolve })
    const execution = new DurableExecutor(deployment, storeA).execute({}, {
      executionId: "cross-cancel",
      deadline: Date.now() + 120_000,
      wakeupSweepMs: 200,
      afterTimerScheduled: () => { scheduledResolve() }
    })
    await scheduled
    // The cancellation commits through connection B; connection A's notifier
    // never fires, so the fallback sweep alone must interrupt the wait long
    // before the persisted 30s wake time.
    storeB.cancelExecution("cross-cancel", { name: "CrossConnectionCancel" })
    const cancelledAt = Date.now()
    await expect(execution).rejects.toBeInstanceOf(DurableExecutionCancelled)
    expect(Date.now() - cancelledAt).toBeLessThan(10_000)
    expect(storeA.getNode("cross-cancel", nodeId).status).toBe("cancelled")
  } finally {
    storeA.close()
    storeB.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("the wakeup service notifies parked waiters, elapses without notification, and validates inputs", async () => {
  const service = new WakeupService()
  const first = service.wait("execution", Date.now() + 60_000)
  const second = service.wait("execution", Date.now() + 60_000)
  const unrelated = service.wait("other", Date.now() + 40)
  service.notify("execution")
  expect(await first).toBe("notified")
  expect(await second).toBe("notified")
  // A waiter on a different execution is untouched and simply elapses.
  expect(await unrelated).toBe("elapsed")
  // Notifying with no parked waiters is a harmless no-op.
  service.notify("nobody")
  // A notification is not stored: a later wait must elapse on its own.
  expect(await service.wait("execution", Date.now() + 30)).toBe("elapsed")
  expect(() => service.wait("", Date.now() + 10)).toThrow(TypeError)
  expect(() => service.wait("execution", -1)).toThrow(TypeError)
  expect(() => service.wait("execution", 1.5)).toThrow(TypeError)
})
