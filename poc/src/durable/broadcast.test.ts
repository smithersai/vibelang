import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  allPlanNodes,
  compileDurableSource,
  ContentIntegrityError,
  CoordinatorCrash,
  Deployment,
  digest,
  DurableExecutionCancelled,
  DurableExecutor,
  DurableStore,
  PlanArtifact,
  SignalDeliveryConflictError,
  SignalDeliveryRejectedError,
  SignalDeliveryUnauthorizedError,
  signalContractIdentity,
  structuralSchema,
  type SignalNode
} from "./index.ts"

const source = `
import { durable, waitBroadcast } from "smithers:flows"

throw new Error("durable broadcast lowering must not evaluate author code")

export const Rollout = durable(function Rollout(input: { service: string }) {
  const notice = waitBroadcast<{ version: string }>("deploy.rolled")
  return { service: input.service, notice: notice }
})
`

const unicastSource = `
import { durable, waitSignal } from "smithers:flows"
export const Single = durable(function Single(input: { service: string }) {
  return waitSignal<{ version: string }>("deploy.rolled")
})
`

const compile = (text: string, id: string, flowId = `test/source/${id}`) => {
  const result = compileDurableSource(text, {
    fileName: `flows/${id.toLowerCase()}.sm.ts`,
    flowId,
    flowVersion: 1,
    actions: []
  })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result
}

const fixture = (id = "broadcast-deployment") => {
  const compiled = compile(source, "Rollout")
  const node = allPlanNodes(compiled.plan).find(
    (candidate): candidate is SignalNode => candidate.kind === "signal"
  )
  if (node === undefined) throw new Error("expected a signal Plan node")
  return { compiled, node, deployment: Deployment.build({ id, flow: compiled.flow, pools: [] }) }
}

const temporaryDatabase = async (body: (filename: string) => Promise<void>): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), "smithers-durable-broadcast-"))
  const filename = join(directory, "state.sqlite")
  try {
    await body(filename)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 3_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(5)
  }
}

/** Deterministically corrupts the last character of an opaque hex token. */
const tamper = (token: string): string =>
  `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`

const subscribed = (store: DurableStore, executionId: string): boolean =>
  store.journal(executionId).some((event) => event.type === "broadcast_subscribed")

test("broadcast lowering produces a distinct contract identity from the unicast form", () => {
  const { compiled, node } = fixture()
  expect(compiled.plan.formatVersion).toBe(3)
  expect(node.delivery).toBe("broadcast")
  expect(node.signalContractDigest).toBe(
    signalContractIdentity(node.signalId, node.payloadSchema, "broadcast")
  )
  // The two delivery forms are never the same contract, even for one identity
  // and one payload type.
  expect(node.signalContractDigest).not.toBe(
    signalContractIdentity(node.signalId, node.payloadSchema)
  )
  const unicast = compile(unicastSource, "Single")
  const unicastNode = allPlanNodes(unicast.plan).find(
    (candidate): candidate is SignalNode => candidate.kind === "signal"
  )!
  expect(unicastNode.delivery).toBeUndefined()
  expect(unicastNode.signalContractDigest).not.toBe(node.signalContractDigest)

  // The unicast encoding must never gain the field: that would silently move
  // every pre-existing Plan's pinned contract digest.
  const relabelled = {
    ...unicast.plan,
    formatVersion: 3,
    nodes: unicast.plan.nodes.map((candidate) =>
      candidate.id === unicastNode.id ? { ...candidate, delivery: "unicast" } : candidate)
  }
  const { digest: _drop, ...semantic } = relabelled
  expect(() => PlanArtifact.decode(PlanArtifact.encode({ ...semantic, digest: digest(semantic) } as never)))
    .toThrow(/unsupported signal delivery mode/)

  // A broadcast node smuggled into a version-2 artifact fails on version.
  const downgraded = { ...compiled.plan, formatVersion: 2 }
  const { digest: _dropped, ...downgradedSemantic } = downgraded
  expect(() => PlanArtifact.decode(PlanArtifact.encode({
    ...downgradedSemantic,
    digest: digest(downgradedSemantic)
  } as never))).toThrow(/broadcast signals require Plan format version 3/)

  // A forged payload schema no longer matches the pinned contract digest.
  const forged = {
    ...compiled.plan,
    nodes: compiled.plan.nodes.map((candidate) =>
      candidate.id === node.id
        ? { ...candidate, payloadSchema: structuralSchema("input", { kind: "string" }) }
        : candidate)
  }
  const { digest: _forged, ...forgedSemantic } = forged
  expect(() => PlanArtifact.decode(PlanArtifact.encode({
    ...forgedSemantic,
    digest: digest(forgedSemantic)
  } as never))).toThrow(/signal contract digest mismatch/)
})

test("one broadcast delivery satisfies every subscribed execution exactly once", async () => {
  const { deployment, node } = fixture()
  const store = new DurableStore()
  const executor = new DurableExecutor(deployment, store)
  const handles = ["b-1", "b-2", "b-3"].map((executionId) =>
    executor.start({ service: executionId }, { executionId, deadline: Date.now() + 20_000 }))
  await waitFor(
    () => ["b-1", "b-2", "b-3"].every((executionId) => subscribed(store, executionId)),
    "all three subscriptions"
  )
  // Suspension holds attempt zero and no lease, exactly like a unicast wait.
  const waiting = store.database.query(
    "SELECT status,attempt,owner,lease_until FROM durable_nodes WHERE execution_id='b-1' AND node_id=?"
  ).get(node.id)
  expect(waiting).toEqual({ status: "pending", attempt: 0, owner: null, lease_until: null })

  const grant = executor.grantBroadcast("deploy.rolled")
  const delivered = executor.deliverBroadcast(
    { signalId: "deploy.rolled", idempotencyKey: "roll-1", payload: { version: "2.0" } },
    { senderToken: grant.senderToken }
  )
  expect(delivered.duplicate).toBe(false)
  expect([...delivered.notifiedExecutions].sort()).toEqual(["b-1", "b-2", "b-3"])

  for (const handle of handles) {
    expect(await handle.result()).toMatchObject({ notice: { version: "2.0" } })
  }
  // One delivery row, three per-execution consumption records.
  expect(store.database.query("SELECT COUNT(*) AS count FROM durable_broadcast_deliveries").get())
    .toEqual({ count: 1 })
  const consumptions = store.database.query(
    "SELECT execution_id,sequence FROM durable_broadcast_consumptions ORDER BY execution_id"
  ).all() as readonly { execution_id: string; sequence: number }[]
  expect(consumptions).toEqual([
    { execution_id: "b-1", sequence: 1 },
    { execution_id: "b-2", sequence: 1 },
    { execution_id: "b-3", sequence: 1 }
  ])
  for (const executionId of ["b-1", "b-2", "b-3"]) {
    const types = store.journal(executionId).map((event) => event.type)
    expect(types.filter((type) => type === "broadcast_consumed")).toHaveLength(1)
  }
  store.close()
})

test("the durable subscription watermark decides entitlement, so a late waiter never retro-consumes", async () => {
  const { deployment } = fixture("broadcast-watermark")
  const store = new DurableStore()
  const executor = new DurableExecutor(deployment, store)
  const early = executor.start({ service: "early" }, { executionId: "w-early", deadline: Date.now() + 20_000 })
  await waitFor(() => subscribed(store, "w-early"), "early subscription")

  const grant = { senderToken: executor.grantBroadcast("deploy.rolled").senderToken }
  executor.deliverBroadcast(
    { signalId: "deploy.rolled", idempotencyKey: "roll-1", payload: { version: "1.0" } },
    grant
  )
  expect(await early.result()).toMatchObject({ notice: { version: "1.0" } })

  // A later execution subscribes above that delivery and must keep waiting.
  const late = executor.start({ service: "late" }, {
    executionId: "w-late",
    deadline: Date.now() + 20_000,
    wakeupSweepMs: 20
  })
  await waitFor(() => subscribed(store, "w-late"), "late subscription")
  const watermark = store.journal("w-late").find((event) => event.type === "broadcast_subscribed")!.payload
  expect(watermark).toMatchObject({ watermark: 1 })
  await Bun.sleep(80)
  expect(store.getNode("w-late", store.journal("w-late")[1]!.nodeId!).status).toBe("pending")

  executor.deliverBroadcast(
    { signalId: "deploy.rolled", idempotencyKey: "roll-2", payload: { version: "2.0" } },
    grant
  )
  expect(await late.result()).toMatchObject({ notice: { version: "2.0" } })
  // The early execution stays on its own committed delivery.
  expect(store.getExecution("w-early").output).toMatchObject({ notice: { version: "1.0" } })
  store.close()
})

test("broadcast delivery is idempotent by key, fails closed on conflict, and requires sender evidence", () => {
  const { deployment } = fixture("broadcast-auth")
  const store = new DurableStore()
  const executor = new DurableExecutor(deployment, store)
  executor.start({ service: "a" }, { executionId: "auth-run", deadline: Date.now() + 300 })

  const senderToken = executor.grantBroadcast("deploy.rolled").senderToken
  const first = executor.deliverBroadcast(
    { signalId: "deploy.rolled", idempotencyKey: "same", payload: { version: "1.0" } },
    { senderToken }
  )
  const repeat = executor.deliverBroadcast(
    { signalId: "deploy.rolled", idempotencyKey: "same", payload: { version: "1.0" } },
    { senderToken }
  )
  expect(first.duplicate).toBe(false)
  expect(repeat.duplicate).toBe(true)
  expect(repeat.sequence).toBe(first.sequence)
  expect(repeat.deliveryDigest).toBe(first.deliveryDigest)

  expect(() => executor.deliverBroadcast(
    { signalId: "deploy.rolled", idempotencyKey: "same", payload: { version: "9.9" } },
    { senderToken }
  )).toThrow(SignalDeliveryConflictError)

  // The payload schema is the Plan's, never the sender's.
  expect(() => executor.deliverBroadcast(
    { signalId: "deploy.rolled", idempotencyKey: "bad", payload: { version: 2 } },
    { senderToken }
  )).toThrow(SignalDeliveryRejectedError)
  expect(() => executor.deliverBroadcast(
    { signalId: "deploy.rolled", idempotencyKey: "bad", payload: { version: "2.0", extra: true } },
    { senderToken }
  )).toThrow(SignalDeliveryRejectedError)

  // Fail-closed sender authorization, checked before any state is read.
  expect(() => executor.deliverBroadcast(
    { signalId: "deploy.rolled", idempotencyKey: "x", payload: { version: "2.0" } }
  )).toThrow(SignalDeliveryUnauthorizedError)
  expect(() => executor.deliverBroadcast(
    { signalId: "deploy.rolled", idempotencyKey: "x", payload: { version: "2.0" } },
    { senderToken: tamper(senderToken) }
  )).toThrow(SignalDeliveryUnauthorizedError)
  // A unicast token for a broadcast identity cannot even be minted: the mint is
  // where the two delivery forms are discriminated, so the token that would have
  // authorized a unicast inbox write against this node never exists.
  expect(() => store.mintSignalToken("auth-run", "deploy.rolled"))
    .toThrow(SignalDeliveryRejectedError)
  expect(() => executor.grantSignal("auth-run", "deploy.rolled"))
    .toThrow(/does not address a signal in this deployment Plan/)
  expect(() => store.mintBroadcastToken("unknown.signal")).toThrow(SignalDeliveryRejectedError)
  expect(() => executor.deliverBroadcast(
    { signalId: "unknown.signal", idempotencyKey: "x", payload: { version: "2.0" } },
    { senderToken }
  )).toThrow(/does not address a broadcast signal/)
  store.close()
})

test("single-delivery and broadcast identities can never be confused", () => {
  const broadcast = fixture("ambiguity-broadcast")
  const unicast = compile(unicastSource, "Single", "test/source/Single")
  const unicastDeployment = Deployment.build({ id: "ambiguity-unicast", flow: unicast.flow, pools: [] })

  // Broadcast first, then a unicast Flow claiming the same identity.
  const first = new DurableStore()
  new DurableExecutor(broadcast.deployment, first)
    .start({ service: "a" }, { executionId: "amb-a", deadline: Date.now() + 200 })
  expect(() => new DurableExecutor(unicastDeployment, first).execute({ service: "b" }, {
    executionId: "amb-b",
    deadline: Date.now() + 200
  })).toThrow(SignalDeliveryConflictError)
  first.close()

  // Unicast first, then a broadcast Flow claiming the same identity.
  const second = new DurableStore()
  new DurableExecutor(unicastDeployment, second)
    .start({ service: "a" }, { executionId: "amb-c", deadline: Date.now() + 200 })
  expect(() => new DurableExecutor(broadcast.deployment, second).execute({ service: "b" }, {
    executionId: "amb-d",
    deadline: Date.now() + 200
  })).toThrow(SignalDeliveryConflictError)
  second.close()

  // Two Flows disagreeing about one broadcast payload contract also fail closed.
  const retyped = compile(`
    import { durable, waitBroadcast } from "smithers:flows"
    export const Other = durable(function Other(input: { service: string }) {
      return waitBroadcast<{ version: number }>("deploy.rolled")
    })
  `, "Other", "test/source/Other")
  const third = new DurableStore()
  new DurableExecutor(broadcast.deployment, third)
    .start({ service: "a" }, { executionId: "amb-e", deadline: Date.now() + 200 })
  expect(() => new DurableExecutor(
    Deployment.build({ id: "ambiguity-retyped", flow: retyped.flow, pools: [] }),
    third
  ).execute({ service: "b" }, { executionId: "amb-f", deadline: Date.now() + 200 }))
    .toThrow(SignalDeliveryConflictError)
  third.close()
})

test("a single-delivery send can never be addressed at a broadcast node, and both forms still arrive", async () => {
  const { deployment, node } = fixture("cross-form-delivery")
  const store = new DurableStore()
  const executor = new DurableExecutor(deployment, store)
  const handle = executor.start({ service: "a" }, {
    executionId: "x-run",
    deadline: Date.now() + 20_000
  })
  await waitFor(() => subscribed(store, "x-run"), "the broadcast subscription")

  // The mint is the gate that makes every other unicast entry point reachable,
  // so it fails first and by itself.
  expect(() => store.mintSignalToken("x-run", "deploy.rolled"))
    .toThrow(SignalDeliveryRejectedError)
  expect(() => executor.grantSignal("x-run", "deploy.rolled"))
    .toThrow(/does not address a signal in this deployment Plan/)
  expect(() => handle.signal("deploy.rolled", { idempotencyKey: "k1", payload: { version: "1.0" } }))
    .toThrow(/does not address a signal in this deployment Plan/)
  expect(() => executor.deliverSignal({
    executionId: "x-run",
    nodeId: node.id,
    signalId: "deploy.rolled",
    idempotencyKey: "k1",
    payload: { version: "1.0" }
  }, { unsafeLocalDelivery: true })).toThrow(/does not address a signal in this deployment Plan/)

  // The load-bearing gate is the store's, not the coordinator's: a caller that
  // supplies the node's own (broadcast) contract expectation directly — which
  // agrees with the persisted row, so the digest defence never engages — is
  // still refused. Without this the payload is journaled `signal_delivered` and
  // then discarded forever, because `pollBroadcastSignal` never reads the inbox.
  expect(() => store.deliverSignal({
    executionId: "x-run",
    nodeId: node.id,
    signalId: "deploy.rolled",
    idempotencyKey: "k1",
    payload: { version: "1.0" }
  }, {
    planDigest: deployment.flow.plan.digest,
    signalId: node.signalId,
    signalContractDigest: node.signalContractDigest
  }, { unsafeLocalDelivery: true })).toThrow(SignalDeliveryRejectedError)

  // Nothing was recorded as delivered, and no orphan inbox row survives.
  expect(store.journal("x-run").some((event) => event.type === "signal_delivered")).toBe(false)
  expect(store.database.query("SELECT COUNT(*) AS count FROM durable_signal_inbox").get())
    .toEqual({ count: 0 })
  expect(store.getNode("x-run", node.id).status).toBe("pending")

  // BOTH DIRECTIONS. The legitimate broadcast still fans out and is consumed...
  const delivered = executor.deliverBroadcast(
    { signalId: "deploy.rolled", idempotencyKey: "real", payload: { version: "2.0" } },
    { senderToken: executor.grantBroadcast("deploy.rolled").senderToken }
  )
  expect(delivered.notifiedExecutions).toEqual(["x-run"])
  expect(await handle.result()).toMatchObject({ service: "a", notice: { version: "2.0" } })
  store.close()

  // ... and a genuinely single-delivery node still mints, grants, and receives
  // exactly the delivery the broadcast node just refused.
  const unicast = compile(unicastSource, "Single", "test/source/Single")
  const unicastNode = allPlanNodes(unicast.plan).find(
    (candidate): candidate is SignalNode => candidate.kind === "signal"
  )!
  const unicastStore = new DurableStore()
  const unicastHandle = new DurableExecutor(
    Deployment.build({ id: "cross-form-unicast", flow: unicast.flow, pools: [] }),
    unicastStore
  ).start({ service: "b" }, { executionId: "u-run", deadline: Date.now() + 20_000 })
  await waitFor(
    () => unicastStore.journal("u-run").some((event) => event.type === "signal_waiting"),
    "the single-delivery wait"
  )
  expect(unicastStore.mintSignalToken("u-run", "deploy.rolled").nodeId).toBe(unicastNode.id)
  expect(unicastHandle.signal("deploy.rolled", { idempotencyKey: "k", payload: { version: "3.0" } }).duplicate)
    .toBe(false)
  expect(await unicastHandle.result()).toMatchObject({ version: "3.0" })
  unicastStore.close()
})

test("the attached-child single-delivery chain refuses a broadcast child node too", async () => {
  // `handle.signalChild` -> `deliverAttachedChildSignal` -> `mintAttachedSignalToken`
  // is a second, separately spelled unicast entry point, and it reaches a child
  // execution the caller never held a handle to. It must discriminate exactly
  // like the direct chain.
  const child = compile(source, "Rollout", "test/source/ChildRollout")
  const parent = compileDurableSource(`
import { durable } from "smithers:flows"
import { Rollout } from "test:flows"
export const Top = durable(function Top(input: { service: string }) {
  return Rollout.run({ service: input.service })
})
`, {
    fileName: "flows/top.sm.ts",
    flowId: "test/source/Top",
    flowVersion: 1,
    actions: [],
    flows: [{ moduleSpecifier: "test:flows", exportName: "Rollout", plan: child.plan }]
  })
  if (!parent.ok) throw new Error(JSON.stringify(parent.diagnostics))
  const childFlowNode = parent.plan.nodes.find((candidate) => candidate.kind === "childFlow")!
  const broadcastNode = allPlanNodes(child.plan).find(
    (candidate): candidate is SignalNode => candidate.kind === "signal"
  )!

  const store = new DurableStore()
  const handle = new DurableExecutor(
    Deployment.build({ id: "attached-broadcast", flow: parent.flow, pools: [] }),
    store
  ).start({ service: "a" }, { executionId: "T", deadline: Date.now() + 20_000 })
  handle.result().catch(() => {})
  const childExecutionId = `T::child::${childFlowNode.id}`
  await waitFor(() => subscribed(store, childExecutionId), "the attached child's subscription")

  expect(() => handle.signalChild([childFlowNode.id], "deploy.rolled", {
    idempotencyKey: "k",
    payload: { version: "1.0" }
  })).toThrow(/does not address a signal in the attached child Plan/)
  expect(() => store.mintAttachedSignalToken("T", [childFlowNode.id], "deploy.rolled"))
    .toThrow(SignalDeliveryRejectedError)
  expect(store.database.query("SELECT COUNT(*) AS count FROM durable_signal_inbox").get())
    .toEqual({ count: 0 })

  // BOTH DIRECTIONS: the real broadcast still reaches the attached child.
  expect(store.deliverBroadcast(
    { signalId: "deploy.rolled", idempotencyKey: "real", payload: { version: "9.9" } },
    { signalId: "deploy.rolled", signalContractDigest: broadcastNode.signalContractDigest },
    { senderToken: store.mintBroadcastToken("deploy.rolled").senderToken }
  ).notifiedExecutions).toEqual([childExecutionId])
  expect(await handle.result()).toMatchObject({ notice: { version: "9.9" } })
  store.close()
})

test("a crash after one waiter's broadcast consume leaves the other waiters unaffected", async () => {
  await temporaryDatabase(async (filename) => {
    const { deployment, node } = fixture("broadcast-crash")
    const first = new DurableStore(filename)
    const executor = new DurableExecutor(deployment, first)
    const crashing = executor.execute({ service: "crash" }, {
      executionId: "c-crash",
      deadline: Date.now() + 20_000,
      afterNodeAdopted(nodeId) {
        if (nodeId === node.id) throw new CoordinatorCrash(nodeId)
      }
    })
    const survivor = executor.start({ service: "ok" }, {
      executionId: "c-ok",
      deadline: Date.now() + 20_000
    })
    await waitFor(
      () => subscribed(first, "c-crash") && subscribed(first, "c-ok"),
      "both subscriptions"
    )
    executor.deliverBroadcast(
      { signalId: "deploy.rolled", idempotencyKey: "roll", payload: { version: "3.0" } },
      { senderToken: executor.grantBroadcast("deploy.rolled").senderToken }
    )
    await expect(crashing).rejects.toBeInstanceOf(CoordinatorCrash)
    expect(await survivor.result()).toMatchObject({ notice: { version: "3.0" } })
    first.close()

    const store = new DurableStore(filename)
    const resumed = new DurableExecutor(deployment, store)
    expect(await resumed.resume("c-crash", { deadline: Date.now() + 20_000 }).result())
      .toMatchObject({ notice: { version: "3.0" } })
    // Adoption after restart, not a second consumption.
    expect(store.journal("c-crash").filter((event) => event.type === "broadcast_consumed"))
      .toHaveLength(1)
    expect(store.database.query("SELECT COUNT(*) AS count FROM durable_broadcast_consumptions").get())
      .toEqual({ count: 2 })
    store.close()
  })
})

test("two connections racing one waiter still adopt the delivery exactly once", async () => {
  await temporaryDatabase(async (filename) => {
    const { deployment, node } = fixture("broadcast-race")
    const left = new DurableStore(filename)
    const right = new DurableStore(filename)
    const leftExecutor = new DurableExecutor(deployment, left)
    const rightExecutor = new DurableExecutor(deployment, right)
    const a = leftExecutor.start({ service: "x" }, {
      executionId: "r-1",
      deadline: Date.now() + 20_000,
      wakeupSweepMs: 20
    })
    await waitFor(() => subscribed(left, "r-1"), "subscription")
    // A second coordinator resumes the SAME execution through another
    // connection while the first is still suspended on it.
    const b = rightExecutor.resume("r-1", { deadline: Date.now() + 20_000, wakeupSweepMs: 20 })
    leftExecutor.deliverBroadcast(
      { signalId: "deploy.rolled", idempotencyKey: "one", payload: { version: "4.0" } },
      { senderToken: leftExecutor.grantBroadcast("deploy.rolled").senderToken }
    )
    expect(await a.result()).toMatchObject({ notice: { version: "4.0" } })
    expect(await b.result()).toMatchObject({ notice: { version: "4.0" } })
    const rows = left.database.query(
      "SELECT COUNT(*) AS count FROM durable_broadcast_consumptions WHERE execution_id='r-1'"
    ).get()
    expect(rows).toEqual({ count: 1 })
    expect(left.journal("r-1").filter((event) => event.type === "broadcast_consumed")).toHaveLength(1)
    expect(left.getNode("r-1", node.id).status).toBe("succeeded")
    left.close()
    right.close()
  })
})

test("retention collects only deliveries no live subscription can still claim", async () => {
  const { deployment } = fixture("broadcast-gc")
  const store = new DurableStore()
  const executor = new DurableExecutor(deployment, store)
  const first = executor.start({ service: "one" }, { executionId: "gc-1", deadline: Date.now() + 20_000 })
  await waitFor(() => subscribed(store, "gc-1"), "first subscription")
  const grant = { senderToken: executor.grantBroadcast("deploy.rolled").senderToken }
  executor.deliverBroadcast(
    { signalId: "deploy.rolled", idempotencyKey: "d-1", payload: { version: "1.0" } },
    grant
  )
  expect(await first.result()).toMatchObject({ notice: { version: "1.0" } })

  // A live subscriber whose watermark is below the next delivery pins it.
  const waiting = executor.start({ service: "two" }, {
    executionId: "gc-2",
    deadline: Date.now() + 20_000,
    wakeupSweepMs: 20
  })
  await waitFor(() => subscribed(store, "gc-2"), "second subscription")
  executor.deliverBroadcast(
    { signalId: "deploy.rolled", idempotencyKey: "d-2", payload: { version: "2.0" } },
    grant
  )
  const pinned = store.collectBroadcastDeliveries(0, Date.now() + 60_000)
  expect(pinned.examined).toBe(2)
  // Delivery 1 is at or below the live floor and collectable; delivery 2 is not.
  expect(pinned.deleted).toBe(1)
  expect(store.database.query("SELECT sequence FROM durable_broadcast_deliveries").all())
    .toEqual([{ sequence: 2 }])

  // The consumed waiter still verifies its committed value from its own
  // self-sufficient consumption record after its delivery row is gone.
  expect(await store.getExecution("gc-1").output).toMatchObject({ notice: { version: "1.0" } })
  expect(await executor.resume("gc-1", { deadline: Date.now() + 5_000 }).result())
    .toMatchObject({ notice: { version: "1.0" } })

  expect(await waiting.result()).toMatchObject({ notice: { version: "2.0" } })
  // With no live subscriber left, the remaining delivery becomes collectable.
  expect(store.collectBroadcastDeliveries(0, Date.now() + 60_000)).toEqual({ examined: 1, deleted: 1 })
  // A retention window that has not elapsed collects nothing.
  expect(store.collectBroadcastDeliveries(60_000)).toEqual({ examined: 0, deleted: 0 })
  expect(() => store.collectBroadcastDeliveries(-1)).toThrow(TypeError)
  store.close()
})

test("corrupt persisted broadcast state fails closed instead of replaying", async () => {
  const { deployment, node } = fixture("broadcast-corrupt")
  const store = new DurableStore()
  const executor = new DurableExecutor(deployment, store)
  executor.start({ service: "x" }, {
    executionId: "corrupt-run",
    deadline: Date.now() + 20_000,
    wakeupSweepMs: 5_000
  })
  await waitFor(() => subscribed(store, "corrupt-run"), "subscription")
  executor.deliverBroadcast(
    { signalId: "deploy.rolled", idempotencyKey: "c", payload: { version: "1.0" } },
    { senderToken: executor.grantBroadcast("deploy.rolled").senderToken }
  )
  const expectation = {
    planDigest: deployment.flow.plan.digest,
    signalId: node.signalId,
    signalContractDigest: node.signalContractDigest
  }
  store.database.query("UPDATE durable_broadcast_deliveries SET delivery_digest=? WHERE sequence=1")
    .run("0".repeat(64))
  expect(() => store.pollSignal("corrupt-run", node.id, expectation)).toThrow(ContentIntegrityError)

  store.database.query("UPDATE durable_broadcast_signals SET contract_digest=? WHERE signal_id=?")
    .run("0".repeat(64), node.signalId)
  expect(() => store.deliverBroadcast(
    { signalId: node.signalId, idempotencyKey: "d", payload: { version: "2.0" } },
    { signalId: node.signalId, signalContractDigest: node.signalContractDigest },
    { unsafeLocalDelivery: true }
  )).toThrow(ContentIntegrityError)

  // A forged coordinator contract cannot re-open the wait either.
  expect(() => store.pollSignal("corrupt-run", node.id, {
    ...expectation,
    signalContractDigest: "1".repeat(64)
  })).toThrow(ContentIntegrityError)
  executor.cancel("corrupt-run", { name: "Done", message: "done" })
  await expect(executor.resume("corrupt-run", { deadline: Date.now() + 2_000 }).result())
    .rejects.toBeInstanceOf(DurableExecutionCancelled)
  store.close()
})
