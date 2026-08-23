import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  allPlanNodes,
  compileDurableSource,
  ContentIntegrityError,
  Deployment,
  DurableExecutor,
  DurableStore,
  SignalDeliveryConflictError,
  SignalDeliveryRejectedError,
  SignalDeliveryUnauthorizedError,
  type PlanTemplate,
  type SignalNode
} from "./index.ts"

const compile = (
  text: string,
  fileName: string,
  flowId: string,
  flows: readonly { moduleSpecifier: string; exportName: string; plan: PlanTemplate }[] = []
) => {
  const result = compileDurableSource(text, {
    fileName,
    flowId,
    flowVersion: 1,
    actions: [],
    ...(flows.length === 0 ? {} : { flows })
  })
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
  return result
}

/** Leaf child Flow: the only place the signal contract exists. */
const leaf = compile(`
import { durable, waitSignal } from "smithers:flows"

throw new Error("the authored leaf Flow module must never execute")

export const Leaf = durable(function Leaf(input: { ticket: string }) {
  const decision = waitSignal<{ approved: boolean }>("leaf.approval")
  return { ticket: input.ticket, approved: decision.approved }
})
`, "flows/child-signal-leaf.sm", "test/childsignal/Leaf")

const middle = compile(`
import { durable } from "smithers:flows"
import { Leaf } from "test:leaf-flow"

export const Middle = durable(function Middle(input: { ticket: string }) {
  const leafResult = Leaf.run({ ticket: input.ticket })
  return { relayed: leafResult.approved }
})
`, "flows/child-signal-middle.sm", "test/childsignal/Middle", [
  { moduleSpecifier: "test:leaf-flow", exportName: "Leaf", plan: leaf.plan }
])

/** Depth 1: parent -> leaf. */
const shallow = compile(`
import { durable } from "smithers:flows"
import { Leaf } from "test:leaf-flow"

export const Shallow = durable(function Shallow(input: { ticket: string }) {
  const leafResult = Leaf.run({ ticket: input.ticket })
  return { approved: leafResult.approved }
})
`, "flows/child-signal-shallow.sm", "test/childsignal/Shallow", [
  { moduleSpecifier: "test:leaf-flow", exportName: "Leaf", plan: leaf.plan }
])

/** Depth 2: parent -> middle -> leaf. */
const deep = compile(`
import { durable } from "smithers:flows"
import { Middle } from "test:middle-flow"

export const Deep = durable(function Deep(input: { ticket: string }) {
  const middleResult = Middle.run({ ticket: input.ticket })
  return { relayed: middleResult.relayed }
})
`, "flows/child-signal-deep.sm", "test/childsignal/Deep", [
  { moduleSpecifier: "test:middle-flow", exportName: "Middle", plan: middle.plan }
])

const childFlowNodeId = (plan: PlanTemplate, flowId: string): string => {
  const node = plan.nodes.find(
    (candidate) => candidate.kind === "childFlow" && candidate.flowId === flowId
  )
  if (node === undefined) throw new Error(`expected a childFlow node for ${flowId}`)
  return node.id
}

const leafSignalNode = allPlanNodes(leaf.plan).find(
  (candidate): candidate is SignalNode => candidate.kind === "signal"
)!

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 3_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(5)
  }
}

const shallowDeployment = Deployment.build({ id: "child-signal-shallow", flow: shallow.flow, pools: [] })
const deepDeployment = Deployment.build({ id: "child-signal-deep", flow: deep.flow, pools: [] })

const shallowChildNode = childFlowNodeId(shallow.plan, "test/childsignal/Leaf")
const deepMiddleNode = childFlowNodeId(deep.plan, "test/childsignal/Middle")
const deepLeafNode = childFlowNodeId(middle.plan, "test/childsignal/Leaf")

test("a parent handle addresses a signal inside its attached child Plan", async () => {
  const store = new DurableStore()
  const executor = new DurableExecutor(shallowDeployment, store)
  const handle = executor.start({ ticket: "T-1" }, {
    executionId: "cs-shallow",
    deadline: Date.now() + 20_000
  })
  const childExecutionId = "cs-shallow::child::" + shallowChildNode
  await waitFor(
    () => store.journal(childExecutionId).some((event) => event.type === "signal_waiting"),
    "child signal wait"
  )
  // The parent's childFlow node holds no lease while the child suspends.
  expect(store.getNode("cs-shallow", shallowChildNode).status).toBe("pending")

  const delivered = handle.signalChild([shallowChildNode], "leaf.approval", {
    idempotencyKey: "approve-1",
    payload: { approved: true }
  })
  expect(delivered.duplicate).toBe(false)
  expect(await handle.result()).toEqual({ approved: true })

  // The delivery is journaled against the CHILD execution, addressed by the
  // child's own node identity.
  const childJournal = store.journal(childExecutionId)
  expect(childJournal.find((event) => event.type === "signal_delivered")).toMatchObject({
    nodeId: leafSignalNode.id,
    payload: { signalId: "leaf.approval", idempotencyKey: "approve-1" }
  })
  // Re-delivering the same key is idempotent, and a different payload conflicts.
  expect(handle.signalChild([shallowChildNode], "leaf.approval", {
    idempotencyKey: "approve-1",
    payload: { approved: true }
  }).duplicate).toBe(true)
  expect(() => handle.signalChild([shallowChildNode], "leaf.approval", {
    idempotencyKey: "approve-2",
    payload: { approved: false }
  })).toThrow(SignalDeliveryConflictError)
  store.close()
})

test("a grandchild signal is addressable through the full attached path", async () => {
  const store = new DurableStore()
  const executor = new DurableExecutor(deepDeployment, store)
  const handle = executor.start({ ticket: "T-2" }, {
    executionId: "cs-deep",
    deadline: Date.now() + 20_000
  })
  const middleExecutionId = `cs-deep::child::${deepMiddleNode}`
  const leafExecutionId = `${middleExecutionId}::child::${deepLeafNode}`
  await waitFor(
    () => store.journal(leafExecutionId).some((event) => event.type === "signal_waiting"),
    "grandchild signal wait"
  )
  handle.signalChild([deepMiddleNode, deepLeafNode], "leaf.approval", {
    idempotencyKey: "deep-1",
    payload: { approved: true }
  })
  expect(await handle.result()).toEqual({ relayed: true })
  expect(store.getExecution(leafExecutionId).status).toBe("completed")
  store.close()
})

test("child signal addressing fails closed when the child is not attached to that parent", async () => {
  const store = new DurableStore()
  const executor = new DurableExecutor(shallowDeployment, store)
  const handle = executor.start({ ticket: "T-3" }, {
    executionId: "cs-attach",
    deadline: Date.now() + 20_000
  })
  const sibling = executor.start({ ticket: "T-4" }, {
    executionId: "cs-sibling",
    deadline: Date.now() + 20_000
  })
  await waitFor(
    () => store.journal(`cs-attach::child::${shallowChildNode}`).some((event) => event.type === "signal_waiting") &&
      store.journal(`cs-sibling::child::${shallowChildNode}`).some((event) => event.type === "signal_waiting"),
    "both children waiting"
  )

  const options = { idempotencyKey: "x", payload: { approved: true } } as const
  // An execution that never linked a child at all.
  expect(() => new DurableExecutor(shallowDeployment, store)
    .start({ ticket: "T-5" }, { executionId: "cs-unlinked", deadline: Date.now() + 50 })
    .signalChild([shallowChildNode], "leaf.approval", options))
    .toThrow(SignalDeliveryRejectedError)
  // A node id that is not a childFlow node of this Plan.
  expect(() => handle.signalChild([leafSignalNode.id], "leaf.approval", options))
    .toThrow(/is not a childFlow node of this Plan/)
  // A path that walks one hop too far.
  expect(() => handle.signalChild([shallowChildNode, shallowChildNode], "leaf.approval", options))
    .toThrow(/is not a childFlow node of this Plan/)
  // A signal identity absent from the attached child Plan.
  expect(() => handle.signalChild([shallowChildNode], "not.a.signal", options))
    .toThrow(/does not address a signal in the attached child Plan/)
  // Empty and oversized paths.
  expect(() => handle.signalChild([], "leaf.approval", options))
    .toThrow(/at least one attached childFlow node/)
  // Option shape is still exact.
  expect(() => handle.signalChild([shallowChildNode], "leaf.approval", { idempotencyKey: "x" } as never))
    .toThrow(TypeError)

  // Each handle reaches only its OWN child: the delivery below must land on
  // cs-attach's child and leave the sibling's child untouched.
  handle.signalChild([shallowChildNode], "leaf.approval", {
    idempotencyKey: "only-mine",
    payload: { approved: true }
  })
  expect(await handle.result()).toEqual({ approved: true })
  expect(store.getExecution(`cs-sibling::child::${shallowChildNode}`).status).toBe("running")
  expect(store.journal(`cs-sibling::child::${shallowChildNode}`)
    .some((event) => event.type === "signal_delivered")).toBe(false)

  sibling.cancel({ name: "Done", message: "done" })
  await sibling.result().catch(() => {})
  store.close()
})

test("two connections racing one child delivery converge on a single committed value", async () => {
  const directory = mkdtempSync(join(tmpdir(), "smithers-durable-child-signal-"))
  const filename = join(directory, "state.sqlite")
  try {
    const left = new DurableStore(filename)
    const right = new DurableStore(filename)
    const leftExecutor = new DurableExecutor(shallowDeployment, left)
    const rightExecutor = new DurableExecutor(shallowDeployment, right)
    const handle = leftExecutor.start({ ticket: "T-7" }, {
      executionId: "cs-race",
      deadline: Date.now() + 20_000,
      wakeupSweepMs: 20
    })
    const childExecutionId = `cs-race::child::${shallowChildNode}`
    await waitFor(
      () => left.journal(childExecutionId).some((event) => event.type === "signal_waiting"),
      "child signal wait"
    )
    // A second process re-attaches to the same parent and delivers the same key.
    const other = rightExecutor.resume("cs-race", { deadline: Date.now() + 20_000, wakeupSweepMs: 20 })
    const options = { idempotencyKey: "race-1", payload: { approved: true } } as const
    const results = [
      handle.signalChild([shallowChildNode], "leaf.approval", options),
      other.signalChild([shallowChildNode], "leaf.approval", options)
    ]
    expect(results.filter((entry) => !entry.duplicate)).toHaveLength(1)
    expect(new Set(results.map((entry) => entry.deliveryDigest)).size).toBe(1)
    // A conflicting payload under a different key still fails closed.
    expect(() => other.signalChild([shallowChildNode], "leaf.approval", {
      idempotencyKey: "race-2",
      payload: { approved: false }
    })).toThrow(SignalDeliveryConflictError)
    expect(await handle.result()).toEqual({ approved: true })
    expect(await other.result()).toEqual({ approved: true })
    expect(left.journal(childExecutionId).filter((event) => event.type === "signal_delivered"))
      .toHaveLength(1)
    left.close()
    right.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("no transferable capability is minted for a child signal", async () => {
  const store = new DurableStore()
  const executor = new DurableExecutor(shallowDeployment, store)
  const handle = executor.start({ ticket: "T-6" }, {
    executionId: "cs-authority",
    deadline: Date.now() + 20_000
  })
  const childExecutionId = `cs-authority::child::${shallowChildNode}`
  await waitFor(
    () => store.journal(childExecutionId).some((event) => event.type === "signal_waiting"),
    "child signal wait"
  )
  // The parent deployment declares no such signal, so the ordinary grant
  // surface refuses to mint anything for it.
  expect(() => executor.grantSignal("cs-authority", "leaf.approval"))
    .toThrow(/does not address a signal in this deployment Plan/)
  // The handle exposes delivery, never a token.
  expect(Object.keys(handle).sort()).toEqual([
    "cancel", "executionId", "result", "signal", "signalChild", "status"
  ])
  // Linkage — not any secret the caller holds — is what the store checks.
  expect(() => store.mintAttachedSignalToken("cs-authority", ["not-a-node"], "leaf.approval"))
    .toThrow(SignalDeliveryRejectedError)
  const minted = store.mintAttachedSignalToken("cs-authority", [shallowChildNode], "leaf.approval")
  expect(minted.executionId).toBe(childExecutionId)
  expect(minted.nodeId).toBe(leafSignalNode.id)
  // The minted evidence is exactly the leaf execution's own token, so this
  // widens the parent's reach to attached descendants and to nothing else.
  expect(minted.senderToken).toBe(store.mintSignalToken(childExecutionId, "leaf.approval").senderToken)
  // The parent execution itself pins no such contract, so the token is bound
  // to the child alone and cannot be replayed against the parent.
  expect(() => store.mintSignalToken("cs-authority", "leaf.approval"))
    .toThrow(SignalDeliveryRejectedError)

  handle.signalChild([shallowChildNode], "leaf.approval", {
    idempotencyKey: "final",
    payload: { approved: false }
  })
  expect(await handle.result()).toEqual({ approved: false })
  store.close()
})

test("a forged child contract or foreign token cannot deliver through the parent path", async () => {
  const store = new DurableStore()
  const executor = new DurableExecutor(shallowDeployment, store)
  const handle = executor.start({ ticket: "T-8" }, {
    executionId: "cs-forge",
    deadline: Date.now() + 20_000
  })
  const childExecutionId = `cs-forge::child::${shallowChildNode}`
  await waitFor(
    () => store.journal(childExecutionId).some((event) => event.type === "signal_waiting"),
    "child signal wait"
  )
  const minted = store.mintAttachedSignalToken("cs-forge", [shallowChildNode], "leaf.approval")
  const request = {
    executionId: childExecutionId,
    nodeId: leafSignalNode.id,
    signalId: "leaf.approval",
    idempotencyKey: "forge-1",
    payload: { approved: true }
  } as const
  const honest = {
    planDigest: leaf.plan.digest,
    signalId: leafSignalNode.signalId,
    signalContractDigest: leafSignalNode.signalContractDigest
  } as const

  // A forged coordinator contract for the child Plan is refused.
  expect(() => store.deliverSignal(
    request,
    { ...honest, signalContractDigest: "0".repeat(64) },
    { senderToken: minted.senderToken }
  )).toThrow(ContentIntegrityError)
  // A token minted for the PARENT execution does not authorize the child.
  expect(() => store.deliverSignal(
    request,
    honest,
    { senderToken: store.mintSignalToken("cs-forge", "leaf.approval").senderToken }
  )).toThrow(SignalDeliveryRejectedError)
  // Nor does a token from a different store's secret.
  const foreign = new DurableStore()
  expect(() => store.deliverSignal(request, honest, { senderToken: "vst1_" + "a".repeat(64) }))
    .toThrow(SignalDeliveryUnauthorizedError)
  foreign.close()
  // Nothing above reached the inbox.
  expect(store.journal(childExecutionId).some((event) => event.type === "signal_delivered")).toBe(false)

  handle.signalChild([shallowChildNode], "leaf.approval", {
    idempotencyKey: "forge-1",
    payload: { approved: true }
  })
  expect(await handle.result()).toEqual({ approved: true })
  store.close()
})
