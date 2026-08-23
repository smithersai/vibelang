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
  DurableExecutionCancelled,
  DurableExecutor,
  DurableStore,
  SignalDeliveryConflictError,
  SignalDeliveryRejectedError,
  SignalDeliveryUnauthorizedError,
  type SignalNode
} from "./index.ts"

const approvalSource = `
import { durable, waitSignal } from "smithers:flows"

export const Approval = durable(function Approval(input: { requestId: string }) {
  const decision = waitSignal<{ approved: boolean; ticket: string }>("approval.decided")
  return { requestId: input.requestId, decision: decision }
})
`

const pairSource = `
import { durable, waitSignal } from "smithers:flows"

export const Pair = durable(function Pair(input: {}) {
  const first = waitSignal<{ value: string }>("pair.first")
  const second = waitSignal<{ value: string }>("pair.second")
  return { first: first, second: second }
})
`

const compileFixture = (source: string, name: string) => {
  const compiled = compileDurableSource(source, {
    fileName: `flows/${name}.sm.ts`,
    flowId: `test/transport/${name}`,
    flowVersion: 1,
    actions: []
  })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const nodes = allPlanNodes(compiled.plan).filter((candidate): candidate is SignalNode => candidate.kind === "signal")
  return {
    nodes,
    deployment: Deployment.build({ id: `transport-${name}`, flow: compiled.flow, pools: [] })
  }
}

const request = (
  executionId: string,
  node: SignalNode,
  payload: unknown = { approved: true, ticket: "T-1" },
  idempotencyKey = "event-1"
) => ({ executionId, nodeId: node.id, signalId: node.signalId, idempotencyKey, payload })

const inboxCount = (store: DurableStore, executionId: string): number =>
  (store.database.query(
    "SELECT COUNT(*) AS count FROM durable_signal_inbox WHERE execution_id=?"
  ).get(executionId) as { count: number }).count

const crashAtWait = async (
  executor: DurableExecutor<{ requestId: string }, unknown>,
  executionId: string
): Promise<void> => {
  await expect(executor.execute(
    { requestId: executionId },
    {
      executionId,
      deadline: Date.now() + 30_000,
      afterSignalWaiting(nodeId) {
        throw new CoordinatorCrash(nodeId)
      }
    }
  )).rejects.toBeInstanceOf(CoordinatorCrash)
}

test("delivery without sender evidence fails closed before any execution state is read", async () => {
  const { deployment, nodes: [node] } = compileFixture(approvalSource, "closed")
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    await crashAtWait(executor, "closed")
    // Default is token-required: the exact same request the legacy path accepts
    // is rejected without evidence, and nothing is persisted or journaled.
    expect(() => executor.deliverSignal(request("closed", node!)))
      .toThrow(SignalDeliveryUnauthorizedError)
    expect(() => executor.deliverSignal(request("closed", node!), {}))
      .toThrow(SignalDeliveryUnauthorizedError)
    // An unauthenticated sender cannot even probe execution existence: an
    // unknown execution id is indistinguishable from a real one.
    expect(() => executor.deliverSignal(request("never-created", node!)))
      .toThrow(SignalDeliveryUnauthorizedError)
    expect(inboxCount(store, "closed")).toBe(0)
    expect(store.journal("closed").some((event) => event.type === "signal_delivered")).toBe(false)

    const grant = executor.grantSignal("closed", node!.signalId)
    expect(executor.deliverSignal(request("closed", node!), { senderToken: grant.senderToken }))
      .toMatchObject({ duplicate: false, state: "pending" })
  } finally {
    store.close()
  }
})

test("forged, truncated, and cross-execution replayed tokens are rejected", async () => {
  const { deployment, nodes: [node] } = compileFixture(approvalSource, "adversarial")
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    await crashAtWait(executor, "victim")
    await crashAtWait(executor, "attacker")
    const victimGrant = executor.grantSignal("victim", node!.signalId)
    expect(victimGrant.senderToken).toMatch(/^vst1_[0-9a-f]{64}$/)

    for (const forged of [
      `vst1_${"0".repeat(64)}`,
      victimGrant.senderToken.slice(0, -1),
      victimGrant.senderToken.slice(5),
      `${victimGrant.senderToken}0`,
      "vst1_",
      ""
    ]) {
      expect(() => executor.deliverSignal(request("victim", node!), { senderToken: forged }))
        .toThrow(SignalDeliveryUnauthorizedError)
    }
    // A token minted for one execution cannot be replayed against another.
    expect(() => executor.deliverSignal(
      request("attacker", node!),
      { senderToken: victimGrant.senderToken }
    )).toThrow(SignalDeliveryUnauthorizedError)
    expect(inboxCount(store, "victim")).toBe(0)
    expect(inboxCount(store, "attacker")).toBe(0)

    // The bound identities still authorize exactly their own delivery.
    expect(executor.deliverSignal(
      request("victim", node!),
      { senderToken: victimGrant.senderToken }
    ).duplicate).toBe(false)
    expect(executor.deliverSignal(
      request("attacker", node!),
      { senderToken: executor.grantSignal("attacker", node!.signalId).senderToken }
    ).duplicate).toBe(false)
  } finally {
    store.close()
  }
})

test("a token minted for one signal cannot deliver a different signal", async () => {
  const { deployment, nodes } = compileFixture(pairSource, "pair")
  const first = nodes.find((candidate) => candidate.signalId === "pair.first")
  const second = nodes.find((candidate) => candidate.signalId === "pair.second")
  if (first === undefined || second === undefined) throw new Error("expected two signal nodes")
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    const running = executor.execute({}, { executionId: "pair", deadline: Date.now() + 30_000 })
    const firstGrant = executor.grantSignal("pair", "pair.first")
    expect(() => executor.deliverSignal(
      request("pair", second, { value: "s" }, "second-key"),
      { senderToken: firstGrant.senderToken }
    )).toThrow(SignalDeliveryUnauthorizedError)
    expect(inboxCount(store, "pair")).toBe(0)

    executor.deliverSignal(
      request("pair", first, { value: "f" }, "first-key"),
      { senderToken: firstGrant.senderToken }
    )
    executor.deliverSignal(
      request("pair", second, { value: "s" }, "second-key"),
      { senderToken: executor.grantSignal("pair", "pair.second").senderToken }
    )
    expect(await running).toEqual({ first: { value: "f" }, second: { value: "s" } })
  } finally {
    store.close()
  }
})

test("hostile authorization shapes fail closed without touching the inbox", async () => {
  const { deployment, nodes: [node] } = compileFixture(approvalSource, "hostile")
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    await crashAtWait(executor, "hostile")
    const valid = executor.grantSignal("hostile", node!.signalId).senderToken

    for (const authorization of [
      { senderToken: 42 },
      { senderToken: null },
      { senderToken: [valid] },
      { senderToken: { toString: () => valid } },
      { senderToken: "x".repeat(600) }
    ]) {
      expect(() => executor.deliverSignal(request("hostile", node!), authorization as never))
        .toThrow(SignalDeliveryUnauthorizedError)
    }
    for (const authorization of [
      null,
      [],
      "token",
      { senderToken: valid, unsafeLocalDelivery: true },
      { unsafeLocalDelivery: false },
      { unsafeLocalDelivery: 1 },
      { unsafeLocalDelivery: "true" },
      { extra: true },
      { senderToken: valid, extra: true },
      { [Symbol("senderToken")]: valid }
    ]) {
      expect(() => executor.deliverSignal(request("hostile", node!), authorization as never))
        .toThrow(TypeError)
    }
    expect(inboxCount(store, "hostile")).toBe(0)
    expect(store.journal("hostile").some((event) => event.type === "signal_delivered")).toBe(false)
    executor.cancel("hostile", { name: "TestDone" })
    await expect(new DurableExecutor(deployment, store).execute(
      { requestId: "hostile" },
      { executionId: "hostile" }
    )).rejects.toBeInstanceOf(DurableExecutionCancelled)
  } finally {
    store.close()
  }
})

test("a valid token does not weaken exact identity, idempotency, or conflict rules", async () => {
  const { deployment, nodes: [node] } = compileFixture(approvalSource, "identity")
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    await crashAtWait(executor, "identity")
    const token = executor.grantSignal("identity", node!.signalId).senderToken

    const accepted = executor.deliverSignal(request("identity", node!), { senderToken: token })
    const duplicate = executor.deliverSignal(request("identity", node!), { senderToken: token })
    expect(accepted.duplicate).toBe(false)
    expect(duplicate).toEqual({ ...accepted, duplicate: true })
    expect(() => executor.deliverSignal(
      request("identity", node!, { approved: false, ticket: "T-2" }),
      { senderToken: token }
    )).toThrow(SignalDeliveryConflictError)
    expect(() => executor.deliverSignal(
      { ...request("identity", node!), nodeId: `${node!.id}-wrong` },
      { senderToken: token }
    )).toThrow("does not address a signal")
  } finally {
    store.close()
  }
})

test("minted tokens survive process restart and are identical across live connections", async () => {
  // The token scheme's only committed boundary is the per-database secret at
  // store initialization: a process may die immediately after minting, and a
  // fresh connection must keep honoring previously issued tokens.
  const directory = mkdtempSync(join(tmpdir(), "smithers-token-restart-"))
  const filename = join(directory, "durable.sqlite")
  const { deployment, nodes: [node] } = compileFixture(approvalSource, "restart")
  try {
    const firstStore = new DurableStore(filename)
    const first = new DurableExecutor(deployment, firstStore)
    await crashAtWait(first, "token-restart")
    const minted = first.grantSignal("token-restart", node!.signalId)
    firstStore.close()

    const secondStore = new DurableStore(filename)
    const thirdStore = new DurableStore(filename)
    const second = new DurableExecutor(deployment, secondStore)
    expect(second.grantSignal("token-restart", node!.signalId).senderToken).toBe(minted.senderToken)
    expect(thirdStore.mintSignalToken("token-restart", node!.signalId).senderToken).toBe(minted.senderToken)
    expect(second.deliverSignal(
      request("token-restart", node!),
      { senderToken: minted.senderToken }
    ).duplicate).toBe(false)
    expect(await second.execute(
      { requestId: "token-restart" },
      { executionId: "token-restart" }
    )).toEqual({ requestId: "token-restart", decision: { approved: true, ticket: "T-1" } })
    thirdStore.close()
    secondStore.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("tokens minted under a different database secret are rejected", async () => {
  const { deployment, nodes: [node] } = compileFixture(approvalSource, "foreign")
  const storeA = new DurableStore()
  const storeB = new DurableStore()
  try {
    const executorA = new DurableExecutor(deployment, storeA)
    const executorB = new DurableExecutor(deployment, storeB)
    await crashAtWait(executorA, "foreign")
    await crashAtWait(executorB, "foreign")
    const foreign = executorB.grantSignal("foreign", node!.signalId).senderToken
    expect(() => executorA.deliverSignal(request("foreign", node!), { senderToken: foreign }))
      .toThrow(SignalDeliveryUnauthorizedError)
    expect(inboxCount(storeA, "foreign")).toBe(0)
  } finally {
    storeA.close()
    storeB.close()
  }
})

test("grant minting and the persisted secret fail closed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "smithers-token-secret-"))
  const filename = join(directory, "durable.sqlite")
  const { deployment, nodes: [node] } = compileFixture(approvalSource, "grants")
  try {
    const store = new DurableStore(filename)
    const executor = new DurableExecutor(deployment, store)
    // A grant cannot be minted for a signal this Plan does not declare, an
    // execution that does not exist, or unbounded identities.
    expect(() => executor.grantSignal("anything", "unknown.signal"))
      .toThrow("does not address a signal")
    expect(() => executor.grantSignal("never-created", node!.signalId))
      .toThrow(SignalDeliveryRejectedError)
    expect(() => store.mintSignalToken("", node!.signalId)).toThrow("bounded non-empty string")
    expect(() => store.mintSignalToken("run", "🧪".repeat(200))).toThrow("bounded non-empty string")
    await crashAtWait(executor, "grants")
    expect(executor.grantSignal("grants", node!.signalId).senderToken).toMatch(/^vst1_[0-9a-f]{64}$/)
    store.database.query("UPDATE durable_signal_secret SET secret_hex='not-a-secret' WHERE id=1").run()
    store.close()
    // A corrupt persisted secret is unusable evidence: initialization fails
    // closed instead of silently minting under attacker-chosen bytes.
    expect(() => new DurableStore(filename)).toThrow(ContentIntegrityError)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
