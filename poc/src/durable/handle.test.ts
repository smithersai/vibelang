import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  Action,
  allPlanNodes,
  compileDurableSource,
  CoordinatorCrash,
  Deployment,
  DurableActionFailure,
  DurableExecutionCancelled,
  DurableExecutor,
  DurableStore,
  fail,
  Flow,
  Provider,
  Worker,
  type SignalNode
} from "./index.ts"

const signalSource = `
import { durable, waitSignal } from "smithers:flows"

export const Approval = durable(function Approval(input: { requestId: string }) {
  const decision = waitSignal<{ approved: boolean; ticket: string }>("approval.decided")
  return { requestId: input.requestId, decision: decision }
})
`

const signalFixture = () => {
  const compiled = compileDurableSource(signalSource, {
    fileName: "flows/handle-approval.sm.ts",
    flowId: "test/handle/Approval",
    flowVersion: 1,
    actions: []
  })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const node = allPlanNodes(compiled.plan).find((candidate): candidate is SignalNode => candidate.kind === "signal")
  if (node === undefined) throw new Error("expected signal Plan node")
  return {
    node,
    deployment: Deployment.build({ id: "handle-signal-deployment", flow: compiled.flow, pools: [] })
  }
}

const actionFixture = (suffix: string, calls: { value: number }) => {
  const Work = Action.define<{ value: number }, { doubled: number }>({
    id: `test/Handle/${suffix}`,
    version: 1
  })
  const Program = Flow.define<{ value: number }, { doubled: number }>(
    { id: `test/HandleFlow/${suffix}`, version: 1 },
    (input) => Work.run({ value: input.value })
  )
  const Live = Provider.provide(Work, ({ value }) => {
    calls.value += 1
    return { doubled: value * 2 }
  }, {
    implementationId: `handle-${suffix}`,
    implementationVersion: "1"
  })
  return Deployment.build({
    id: `handle-${suffix}`,
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })]
  })
}

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(5)
  }
}

const waitingAt = (store: DurableStore, executionId: string) => (): boolean =>
  store.journal(executionId).some((event) => event.type === "signal_waiting")

test("start returns a typed handle whose status and result converge with the durable store", async () => {
  const calls = { value: 0 }
  const deployment = actionFixture("success", calls)
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    const handle = executor.start({ value: 4 }, { executionId: "start-success" })
    expect(handle.executionId).toBe("start-success")
    // The synchronous part of start already committed initialization.
    expect(["running", "completed"]).toContain(handle.status())
    expect(await handle.result()).toEqual({ doubled: 8 })
    expect(await handle.result()).toEqual({ doubled: 8 })
    expect(handle.status()).toBe("completed")
    expect(calls.value).toBe(1)
    // execute remains the start-and-await convenience over the same execution.
    expect(await executor.execute({ value: 4 }, { executionId: "start-success" })).toEqual({ doubled: 8 })
    expect(calls.value).toBe(1)
  } finally {
    store.close()
  }
})

test("a handle surfaces the typed terminal failure and failed status", async () => {
  const Work = Action.define<{}, { ok: boolean }, { code: string }>({ id: "test/Handle/Fail", version: 1 })
  const Program = Flow.define<{}, { ok: boolean }>(
    { id: "test/HandleFlow/Fail", version: 1 },
    () => Work.run({})
  )
  const Live = Provider.provide(Work, () => fail({ code: "denied" }), {
    implementationId: "handle-fail",
    implementationVersion: "1"
  })
  const deployment = Deployment.build({
    id: "handle-fail",
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })]
  })
  const store = new DurableStore()
  try {
    const handle = new DurableExecutor(deployment, store).start({}, { executionId: "start-failure" })
    try {
      await handle.result()
      throw new Error("expected a typed durable failure")
    } catch (error) {
      expect(error).toBeInstanceOf(DurableActionFailure)
      expect((error as DurableActionFailure).failure).toEqual({ code: "denied" })
    }
    expect(handle.status()).toBe("failed")
  } finally {
    store.close()
  }
})

test("a handle cancels and signals only its own execution", async () => {
  const { deployment, node } = signalFixture()
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    const deadline = Date.now() + 30_000
    const first = executor.start({ requestId: "one" }, { executionId: "own-1", deadline })
    const second = executor.start({ requestId: "two" }, { executionId: "own-2", deadline })
    await waitFor(waitingAt(store, "own-1"), "own-1 suspension")
    await waitFor(waitingAt(store, "own-2"), "own-2 suspension")

    expect(() => first.signal("unknown.signal", { idempotencyKey: "k", payload: {} }))
      .toThrow("does not address a signal")

    first.cancel({ name: "UserCancelled" })
    await expect(first.result()).rejects.toBeInstanceOf(DurableExecutionCancelled)
    expect(first.status()).toBe("cancelled")
    expect(store.getNode("own-1", node.id).status).toBe("cancelled")

    // The sibling execution is untouched by the first handle's authority.
    expect(second.status()).toBe("running")
    expect(store.journal("own-2").some((event) => event.type === "signal_delivered")).toBe(false)
    const delivered = second.signal(node.signalId, {
      idempotencyKey: "event-1",
      payload: { approved: true, ticket: "T-2" }
    })
    expect(delivered.duplicate).toBe(false)
    expect(await second.result()).toEqual({
      requestId: "two",
      decision: { approved: true, ticket: "T-2" }
    })
    expect(store.journal("own-1").some((event) => event.type === "signal_delivered")).toBe(false)
  } finally {
    store.close()
  }
})

test("handle.signal delivers through the authenticated exact-identity path without a worker lease", async () => {
  const { deployment, node } = signalFixture()
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    const handle = executor.start(
      { requestId: "R-1" },
      { executionId: "handle-signal", deadline: Date.now() + 30_000 }
    )
    await waitFor(waitingAt(store, "handle-signal"), "handle suspension")
    const accepted = handle.signal(node.signalId, {
      idempotencyKey: "event-1",
      payload: { approved: true, ticket: "T-1" }
    })
    expect(accepted.duplicate).toBe(false)
    // Idempotent retry through the same handle adopts the committed winner.
    const retried = handle.signal(node.signalId, {
      idempotencyKey: "event-1",
      payload: { approved: true, ticket: "T-1" }
    })
    expect(retried).toEqual({ ...accepted, duplicate: true })
    expect(await handle.result()).toEqual({
      requestId: "R-1",
      decision: { approved: true, ticket: "T-1" }
    })
    const events = store.journal("handle-signal")
    expect(events.filter((event) => event.type === "signal_delivered")).toHaveLength(1)
    expect(events.filter((event) => event.type === "signal_consumed")).toHaveLength(1)
    expect(events.some((event) => event.type === "attempt_started")).toBe(false)
    expect(store.database.query(
      "SELECT attempt,fence,owner,lease_until,retry_at,wake_at FROM durable_nodes WHERE execution_id=? AND node_id=?"
    ).get("handle-signal", node.id)).toEqual({
      attempt: 0,
      fence: 0,
      owner: null,
      lease_until: null,
      retry_at: null,
      wake_at: null
    })
  } finally {
    store.close()
  }
})

test("a handle is re-obtained from executionId and store alone across process restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "smithers-handle-restart-"))
  const filename = join(directory, "durable.sqlite")
  const { deployment, node } = signalFixture()
  try {
    const firstStore = new DurableStore(filename)
    const first = new DurableExecutor(deployment, firstStore)
    const crashed = first.start({ requestId: "restart" }, {
      executionId: "handle-restart",
      deadline: Date.now() + 30_000,
      afterSignalWaiting(nodeId) {
        throw new CoordinatorCrash(nodeId)
      }
    })
    await expect(crashed.result()).rejects.toBeInstanceOf(CoordinatorCrash)
    firstStore.close()

    const resumedStore = new DurableStore(filename)
    const resumedExecutor = new DurableExecutor(deployment, resumedStore)
    // No original input value is re-supplied: the handle is rebuilt from the
    // execution id plus the pinned, digest-verified store state.
    const resumed = resumedExecutor.resume("handle-restart", { deadline: Date.now() + 30_000 })
    expect(resumed.status()).toBe("running")
    resumed.signal(node.signalId, {
      idempotencyKey: "event-1",
      payload: { approved: false, ticket: "T-9" }
    })
    expect(await resumed.result()).toEqual({
      requestId: "restart",
      decision: { approved: false, ticket: "T-9" }
    })
    expect(resumed.status()).toBe("completed")
    expect(resumedStore.journal("handle-restart").filter((event) => event.type === "signal_delivered"))
      .toHaveLength(1)
    expect(resumedStore.journal("handle-restart").filter((event) => event.type === "signal_consumed"))
      .toHaveLength(1)
    resumedStore.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("resume exposes a committed terminal outcome without re-running and rejects unknown executions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "smithers-handle-resume-"))
  const filename = join(directory, "durable.sqlite")
  const calls = { value: 0 }
  const deployment = actionFixture("resume", calls)
  try {
    const firstStore = new DurableStore(filename)
    expect(await new DurableExecutor(deployment, firstStore).execute(
      { value: 5 },
      { executionId: "resume-done" }
    )).toEqual({ doubled: 10 })
    firstStore.close()

    const resumedStore = new DurableStore(filename)
    const executor = new DurableExecutor(deployment, resumedStore)
    const handle = executor.resume("resume-done")
    expect(handle.status()).toBe("completed")
    expect(await handle.result()).toEqual({ doubled: 10 })
    expect(calls.value).toBe(1)
    expect(() => executor.resume("never-started")).toThrow("Unknown durable execution")
    resumedStore.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("start and handle.signal validate their option shapes exactly", async () => {
  const { deployment, node } = signalFixture()
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    expect(() => executor.start({ requestId: "x" }, { executionId: "" })).toThrow("must be non-empty")
    expect(() => executor.start({ requestId: "x" }, {} as never)).toThrow("must be non-empty")
    expect(() => executor.resume("")).toThrow("must be non-empty")
    await expect(executor.execute(
      { requestId: "x" },
      { executionId: "bad-sweep", wakeupSweepMs: 0, deadline: Date.now() + 50 }
    )).rejects.toThrow("wakeupSweepMs must be a positive safe integer")

    const handle = executor.start(
      { requestId: "exact" },
      { executionId: "exact-options", deadline: Date.now() + 30_000 }
    )
    for (const options of [
      { idempotencyKey: "k" },
      { idempotencyKey: "k", payload: {}, extra: true },
      { payload: {} },
      null,
      [],
      "token"
    ]) {
      expect(() => handle.signal(node.signalId, options as never))
        .toThrow("exactly idempotencyKey and payload")
    }
    handle.cancel()
    await expect(handle.result()).rejects.toBeInstanceOf(DurableExecutionCancelled)
  } finally {
    store.close()
  }
})
