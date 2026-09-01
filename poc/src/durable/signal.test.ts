import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  allPlanNodes,
  canonicalJson,
  compileDurableFlow,
  compileDurableSource,
  ContentIntegrityError,
  CoordinatorCrash,
  Deployment,
  digest,
  DurableActionDefect,
  DurableExecutionCancelled,
  DurableExecutor,
  DurableStore,
  MAX_DURABLE_JSON_NODES,
  PlanArtifact,
  SignalDeliveryConflictError,
  SignalDeliveryRejectedError,
  structuralSchema,
  type SignalNode
} from "./index.ts"

const source = `
import { durable, waitSignal as receive } from "smithers:flows"

throw new Error("durable signal lowering must not evaluate author code")

export const Approval = durable(function Approval(input: { requestId: string }) {
  const decision = receive<{ approved: boolean; ticket: string }>("approval.decided")
  return { requestId: input.requestId, decision: decision }
})
`

const compileSignal = (text = source) => compileDurableSource(text, {
  fileName: "flows/approval.sm.ts",
  flowId: "test/source/Approval",
  flowVersion: 1,
  actions: []
})

const fixture = () => {
  const compiled = compileSignal()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const node = allPlanNodes(compiled.plan).find((candidate): candidate is SignalNode => candidate.kind === "signal")
  if (node === undefined) throw new Error("expected signal Plan node")
  const deployment = Deployment.build({ id: "signal-deployment", flow: compiled.flow, pools: [] })
  return { compiled, node, deployment }
}

const delivery = (
  executionId: string,
  node: SignalNode,
  payload: unknown = { approved: true, ticket: "T-1" },
  idempotencyKey = "event-1"
) => ({ executionId, nodeId: node.id, signalId: node.signalId, idempotencyKey, payload })

const unsafe = { unsafeLocalDelivery: true } as const

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(5)
  }
}

const crashAtWait = async (
  executor: DurableExecutor<{ requestId: string }, unknown>,
  executionId: string,
  deadline = Date.now() + 30_000
): Promise<void> => {
  await expect(executor.execute(
    { requestId: executionId },
    {
      executionId,
      deadline,
      afterSignalWaiting(nodeId) {
        throw new CoordinatorCrash(nodeId)
      }
    }
  )).rejects.toBeInstanceOf(CoordinatorCrash)
}

test("compiler-owned signal lowering derives a stable exact payload contract without evaluating author code", () => {
  const { compiled, node } = fixture()
  expect(compiled.plan.nodes).toHaveLength(1)
  expect(node.signalId).toBe("approval.decided")
  expect(node.payloadSchema.shape).toBe("structural")
  expect(node.payloadSchema.role).toBe("input")
  expect(node.payloadSchema.descriptor).toEqual({
    kind: "object",
    fields: [
      { name: "approved", optional: false, value: { kind: "boolean" } },
      { name: "ticket", optional: false, value: { kind: "string" } }
    ]
  })
  expect(node.signalContractDigest).toBe(digest({
    signalId: node.signalId,
    payloadSchema: node.payloadSchema
  }))
  expect(node.dependencies).toEqual([])

  const repeated = compileSignal(`// unrelated leading edit\n${source}`)
  if (!repeated.ok) throw new Error(JSON.stringify(repeated.diagnostics))
  const repeatedNode = allPlanNodes(repeated.plan).find((candidate) => candidate.kind === "signal")
  expect(repeatedNode?.id).toBe(node.id)
  expect(repeatedNode?.signalContractDigest).toBe(node.signalContractDigest)

  const namespace = compileDurableSource(`
    import * as Flows from "smithers:flows"
    export const F = Flows.durable(function F(input: {}) {
      return Flows.waitSignal<string>("namespace.signal")
    })
  `, { fileName: "flows/namespace-signal.sm.ts", flowId: "test/namespace-signal", actions: [] })
  if (!namespace.ok) throw new Error(JSON.stringify(namespace.diagnostics))
  expect(namespace.plan.nodes).toHaveLength(1)
  expect(namespace.plan.nodes[0]).toMatchObject({ kind: "signal", signalId: "namespace.signal" })
})

test("signal source and artifact contracts fail closed for dynamic, higher-order, duplicate, and forged uses", () => {
  const invalidSources = [
    `import { durable, waitSignal } from "smithers:flows"
     export const F = durable(function F(input: { name: string }) {
       return waitSignal<{ value: string }>(input.name)
     })`,
    `import { durable, waitSignal } from "smithers:flows"
     export const F = durable(function F(input: {}) { return waitSignal("name") })`,
    `import { durable, waitSignal } from "smithers:flows"
     export const F = durable(function F(input: {}) {
       const indirect = waitSignal
       return indirect<{ value: string }>("name")
     })`,
    `import { durable, waitSignal } from "smithers:flows"
     export const F = durable(function F(input: { choose: boolean }) {
       return input.choose
         ? waitSignal<{ value: string }>("same")
         : waitSignal<{ value: string }>("same")
     })`,
    `import { durable, waitSignal } from "smithers:flows"
     export const F = durable(function F(input: {}) {
       return waitSignal<() => void>("callback")
     })`,
    `import { durable } from "smithers:flows"
     function waitSignal<T>(name: string): T { throw new Error(name) }
     export const F = durable(function F(input: {}) {
       return waitSignal<string>("spoof")
     })`
  ]
  for (const [index, invalid] of invalidSources.entries()) {
    // `compileDurableFlow`, not `compileDurableSource`: since
    // `MIGRATION-PLAN.md` step 11 withdrew the Plan lowerer's walls, the Plan
    // compiler SIGNALS a body it has no shape for instead of refusing it, and
    // the entry point whose answer is a verdict is this one. Every spelling
    // here is still refused, and `SMITHERS4199` — the Effect Manifest refusing
    // to state a call it cannot account for — is inside the `SMITHERS41`
    // family the assertion below names.
    const result = compileDurableFlow(invalid, {
      fileName: `flows/invalid-signal-${index}.sm.ts`,
      flowId: `test/invalid-signal-${index}`,
      actions: []
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics[0].code).toMatch(/^SMITHERS41/)
  }

  const { compiled, node } = fixture()
  const mutable = JSON.parse(JSON.stringify(compiled.plan)) as Record<string, unknown>
  const forgedNode = (mutable.nodes as Array<Record<string, unknown>>)[0]
  forgedNode.signalContractDigest = "0".repeat(64)
  const { digest: _oldDigest, ...semantic } = mutable
  expect(() => PlanArtifact.validate({ ...semantic, digest: digest(semantic) }))
    .toThrow("signal contract digest mismatch")

  const wrongSchema = JSON.parse(JSON.stringify(compiled.plan)) as Record<string, unknown>
  const wrongSchemaNode = (wrongSchema.nodes as Array<Record<string, unknown>>)[0]
  const schema = wrongSchemaNode.payloadSchema as Record<string, unknown>
  schema.role = "success"
  const { digest: _oldWrongDigest, ...wrongSemantic } = wrongSchema
  expect(() => PlanArtifact.validate({ ...wrongSemantic, digest: digest(wrongSemantic) }))
    .toThrow("unsupported durable schema")

  expect(node.kind).toBe("signal")
})

test("delivery before the first wait is persisted, schema checked, and consumed without a worker lease", async () => {
  const { deployment, node } = fixture()
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    const running = executor.execute({ requestId: "R-1" }, { executionId: "before-wait" })
    expect(() => executor.deliverSignal(delivery(
      "before-wait",
      node,
      new Array(MAX_DURABLE_JSON_NODES + 1).fill(null)
    ), unsafe)).toThrow(/own-field limit|node limit/)
    expect(() => executor.deliverSignal(delivery(
      "before-wait",
      node,
      { approved: true, ticket: "x".repeat(8 * 1024 * 1024) }
    ), unsafe)).toThrow("canonical message size limit")
    expect(store.database.query(
      "SELECT COUNT(*) AS count FROM durable_signal_inbox WHERE execution_id=?"
    ).get("before-wait")).toEqual({ count: 0 })
    const accepted = executor.deliverSignal(delivery("before-wait", node), unsafe)
    expect(accepted).toMatchObject({ duplicate: false, state: "pending" })
    expect(await running).toEqual({
      requestId: "R-1",
      decision: { approved: true, ticket: "T-1" }
    })
    const scheduling = store.database.query(
      "SELECT attempt,fence,owner,lease_until,retry_at,wake_at FROM durable_nodes WHERE execution_id=? AND node_id=?"
    ).get("before-wait", node.id)
    expect(scheduling).toEqual({ attempt: 0, fence: 0, owner: null, lease_until: null, retry_at: null, wake_at: null })
    const events = store.journal("before-wait")
    expect(events.filter((event) => event.type === "signal_delivered")).toHaveLength(1)
    expect(events.filter((event) => event.type === "signal_consumed")).toHaveLength(1)
    expect(events.some((event) => event.type === "attempt_started")).toBe(false)
    expect(events.findIndex((event) => event.type === "signal_delivered"))
      .toBeLessThan(events.findIndex((event) => event.type === "signal_consumed"))
  } finally {
    store.close()
  }
})

test("wait state survives restart and exact delivery identity, schema, and idempotence are enforced", async () => {
  const directory = mkdtempSync(join(tmpdir(), "smithers-signal-restart-"))
  const filename = join(directory, "durable.sqlite")
  const { deployment, node } = fixture()
  try {
    const firstStore = new DurableStore(filename)
    const first = new DurableExecutor(deployment, firstStore)
    await crashAtWait(first, "restart")
    expect(firstStore.journal("restart").filter((event) => event.type === "signal_waiting")).toHaveLength(1)
    expect(firstStore.database.query(
      "SELECT status,attempt,fence,owner,lease_until FROM durable_nodes WHERE execution_id=? AND node_id=?"
    ).get("restart", node.id)).toEqual({ status: "pending", attempt: 0, fence: 0, owner: null, lease_until: null })
    firstStore.close()

    const resumedStore = new DurableStore(filename)
    const resumed = new DurableExecutor(deployment, resumedStore)
    expect(() => resumed.deliverSignal(delivery("missing", node), unsafe)).toThrow(SignalDeliveryRejectedError)
    expect(() => resumed.deliverSignal({ ...delivery("restart", node), nodeId: `${node.id}-wrong` }, unsafe))
      .toThrow("does not address a signal")
    expect(() => resumed.deliverSignal({ ...delivery("restart", node), signalId: "wrong" }, unsafe))
      .toThrow("does not address a signal")
    expect(() => resumed.deliverSignal(delivery("restart", node, { approved: true }), unsafe))
      .toThrow(SignalDeliveryRejectedError)
    expect(() => resumed.deliverSignal(delivery(
      "restart", node, undefined, "🧪".repeat(200)
    ), unsafe)).toThrow("bounded non-empty string")

    const accepted = resumed.deliverSignal(delivery("restart", node), unsafe)
    const duplicate = resumed.deliverSignal(delivery("restart", node), unsafe)
    expect(accepted.duplicate).toBe(false)
    expect(duplicate).toEqual({ ...accepted, duplicate: true })
    expect(() => resumed.deliverSignal(delivery(
      "restart", node, { approved: false, ticket: "T-2" }, "event-1"
    ), unsafe)).toThrow(SignalDeliveryConflictError)
    expect(() => resumed.deliverSignal(delivery("restart", node, undefined, "event-2"), unsafe))
      .toThrow(SignalDeliveryConflictError)

    expect(await resumed.execute({ requestId: "restart" }, { executionId: "restart" })).toEqual({
      requestId: "restart",
      decision: { approved: true, ticket: "T-1" }
    })
    expect(resumedStore.journal("restart").filter((event) => event.type === "signal_delivered")).toHaveLength(1)
    expect(resumedStore.journal("restart").filter((event) => event.type === "signal_consumed")).toHaveLength(1)
    resumedStore.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("delivery and consume commits each survive coordinator death before exposure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "smithers-signal-commit-crash-"))
  const filename = join(directory, "durable.sqlite")
  const { deployment, node } = fixture()
  try {
    const waitingStore = new DurableStore(filename)
    const waiting = new DurableExecutor(deployment, waitingStore)
    await crashAtWait(waiting, "commit-crash")
    waiting.deliverSignal(delivery("commit-crash", node), unsafe)
    expect(waitingStore.journal("commit-crash").filter((event) => event.type === "signal_delivered"))
      .toHaveLength(1)
    waitingStore.close()

    const consumingStore = new DurableStore(filename)
    const consuming = new DurableExecutor(deployment, consumingStore)
    await expect(consuming.execute(
      { requestId: "commit-crash" },
      {
        executionId: "commit-crash",
        afterNodeAdopted(nodeId) {
          throw new CoordinatorCrash(nodeId)
        }
      }
    )).rejects.toBeInstanceOf(CoordinatorCrash)
    expect(consumingStore.getExecution("commit-crash").status).toBe("running")
    expect(consumingStore.getNode("commit-crash", node.id).status).toBe("succeeded")
    expect(consumingStore.journal("commit-crash").filter((event) => event.type === "signal_consumed"))
      .toHaveLength(1)
    consumingStore.close()

    const replayStore = new DurableStore(filename)
    const replay = new DurableExecutor(deployment, replayStore)
    expect(await replay.execute(
      { requestId: "commit-crash" },
      { executionId: "commit-crash" }
    )).toEqual({
      requestId: "commit-crash",
      decision: { approved: true, ticket: "T-1" }
    })
    expect(replayStore.journal("commit-crash").filter((event) => event.type === "signal_delivered"))
      .toHaveLength(1)
    expect(replayStore.journal("commit-crash").filter((event) => event.type === "signal_consumed"))
      .toHaveLength(1)
    expect(replayStore.journal("commit-crash").filter((event) => event.type === "node_succeeded"))
      .toHaveLength(1)
    replayStore.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("cancellation and persisted deadlines terminate suspended signals without leases", async () => {
  const { deployment, node } = fixture()

  const cancellationStore = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, cancellationStore)
    const running = executor.execute({ requestId: "cancel" }, { executionId: "cancel", deadline: Date.now() + 10_000 })
    await waitFor(
      () => cancellationStore.journal("cancel").some((event) => event.type === "signal_waiting"),
      "signal cancellation suspension"
    )
    executor.cancel("cancel", { name: "UserCancelled" })
    await expect(running).rejects.toBeInstanceOf(DurableExecutionCancelled)
    expect(cancellationStore.getNode("cancel", node.id).status).toBe("cancelled")
    expect(() => executor.deliverSignal(delivery("cancel", node), unsafe)).toThrow(SignalDeliveryRejectedError)
  } finally {
    cancellationStore.close()
  }

  const deadlineStore = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, deadlineStore)
    await expect(executor.execute(
      { requestId: "deadline" },
      { executionId: "deadline", deadline: Date.now() + 35 }
    )).rejects.toBeInstanceOf(DurableActionDefect)
    expect(deadlineStore.getNode("deadline", node.id).status).toBe("defect")
    expect(() => executor.deliverSignal(delivery("deadline", node), unsafe)).toThrow(SignalDeliveryRejectedError)
    expect(deadlineStore.journal("deadline").some((event) => event.type === "attempt_started")).toBe(false)
  } finally {
    deadlineStore.close()
  }
})

test("a signal in an unselected branch is skipped and can never be delivered afterward", async () => {
  const branchSource = `
import { durable, waitSignal } from "smithers:flows"
export const Maybe = durable(function Maybe(input: { wait: boolean }) {
  return input.wait
    ? waitSignal<{ approved: boolean; ticket: string }>("branch.approval")
    : { approved: false, ticket: "skipped" }
})
`
  const compiled = compileDurableSource(branchSource, {
    fileName: "flows/branch-signal.sm.ts",
    flowId: "test/source/BranchSignal",
    actions: []
  })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const node = allPlanNodes(compiled.plan).find((candidate): candidate is SignalNode => candidate.kind === "signal")
  if (node === undefined) throw new Error("expected branch signal")
  const deployment = Deployment.build({ id: "branch-signal", flow: compiled.flow, pools: [] })
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    expect(await executor.execute({ wait: false }, { executionId: "branch-skipped" }))
      .toEqual({ approved: false, ticket: "skipped" })
    expect(store.getNode("branch-skipped", node.id).status).toBe("skipped")
    expect(() => executor.deliverSignal(delivery("branch-skipped", node), unsafe)).toThrow(SignalDeliveryRejectedError)
    expect(store.journal("branch-skipped").some((event) => event.type === "signal_waiting")).toBe(false)
    expect(store.journal("branch-skipped").some((event) => event.type === "signal_delivered")).toBe(false)

    // Execution initialization creates every branch-local node. A delivery can
    // therefore race branch selection; the losing branch must discard it in
    // the same transaction that records the skip.
    const racing = executor.execute({ wait: false }, { executionId: "branch-predelivered" })
    expect(executor.deliverSignal(delivery("branch-predelivered", node), unsafe).state).toBe("pending")
    expect(await racing).toEqual({ approved: false, ticket: "skipped" })
    expect(store.getNode("branch-predelivered", node.id).status).toBe("skipped")
    expect(store.database.query(
      "SELECT state,consumed_at,discarded_at FROM durable_signal_inbox WHERE execution_id=? AND node_id=?"
    ).get("branch-predelivered", node.id)).toMatchObject({
      state: "discarded",
      consumed_at: null
    })
    expect(store.journal("branch-predelivered").filter((event) => event.type === "signal_discarded"))
      .toHaveLength(1)
  } finally {
    store.close()
  }
})

test("two coordinators and duplicate external deliveries converge on one atomic inbox value", async () => {
  const directory = mkdtempSync(join(tmpdir(), "smithers-signal-race-"))
  const filename = join(directory, "durable.sqlite")
  const { deployment, node } = fixture()
  const firstStore = new DurableStore(filename)
  const secondStore = new DurableStore(filename)
  try {
    const first = new DurableExecutor(deployment, firstStore)
    await crashAtWait(first, "race")
    const second = new DurableExecutor(deployment, secondStore)
    const firstRun = first.execute({ requestId: "race" }, { executionId: "race" })
    const secondRun = second.execute({ requestId: "race" }, { executionId: "race" })
    const results = await Promise.all([
      Promise.resolve().then(() => first.deliverSignal(delivery("race", node), unsafe)),
      Promise.resolve().then(() => second.deliverSignal(delivery("race", node), unsafe))
    ])
    expect(results.filter((result) => result.duplicate)).toHaveLength(1)
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1)
    expect(await firstRun).toEqual(await secondRun)
    expect(firstStore.journal("race").filter((event) => event.type === "signal_delivered")).toHaveLength(1)
    expect(firstStore.journal("race").filter((event) => event.type === "signal_consumed")).toHaveLength(1)
    expect(firstStore.journal("race").filter((event) => event.type === "node_succeeded")).toHaveLength(1)
  } finally {
    firstStore.close()
    secondStore.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("persisted signal contracts, inbox payloads, and delivery evidence detect corruption", async () => {
  const { deployment, node } = fixture()

  const contractStore = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, contractStore)
    await crashAtWait(executor, "contract-corrupt")
    contractStore.database.query(
      "UPDATE durable_signal_contracts SET payload_schema_digest=? WHERE execution_id=? AND node_id=?"
    ).run("0".repeat(64), "contract-corrupt", node.id)
    expect(() => executor.deliverSignal(delivery("contract-corrupt", node), unsafe)).toThrow(ContentIntegrityError)
  } finally {
    contractStore.close()
  }

  const rewrittenContractStore = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, rewrittenContractStore)
    await crashAtWait(executor, "contract-rewritten")
    const forgedSchema = structuralSchema("input", { kind: "string" })
    rewrittenContractStore.database.query(
      `UPDATE durable_signal_contracts SET
        payload_schema_json=?,payload_schema_storage_digest=?,payload_schema_digest=?,contract_digest=?
       WHERE execution_id=? AND node_id=?`
    ).run(
      canonicalJson(forgedSchema),
      digest(forgedSchema),
      forgedSchema.digest,
      digest({ signalId: node.signalId, payloadSchema: forgedSchema }),
      "contract-rewritten",
      node.id
    )
    expect(() => executor.deliverSignal(delivery("contract-rewritten", node), unsafe))
      .toThrow(ContentIntegrityError)
  } finally {
    rewrittenContractStore.close()
  }

  const inboxStore = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, inboxStore)
    await crashAtWait(executor, "inbox-corrupt")
    executor.deliverSignal(delivery("inbox-corrupt", node), unsafe)
    inboxStore.database.query(
      "UPDATE durable_signal_inbox SET payload_json=? WHERE execution_id=? AND node_id=?"
    ).run('{"approved":false,"ticket":"forged"}', "inbox-corrupt", node.id)
    await expect(executor.execute(
      { requestId: "inbox-corrupt" },
      { executionId: "inbox-corrupt" }
    )).rejects.toBeInstanceOf(ContentIntegrityError)
  } finally {
    inboxStore.close()
  }

  const evidenceStore = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, evidenceStore)
    await crashAtWait(executor, "evidence-corrupt")
    executor.deliverSignal(delivery("evidence-corrupt", node), unsafe)
    evidenceStore.database.query(
      "UPDATE durable_signal_inbox SET delivery_digest=? WHERE execution_id=? AND node_id=?"
    ).run("f".repeat(64), "evidence-corrupt", node.id)
    expect(() => executor.deliverSignal(delivery("evidence-corrupt", node), unsafe)).toThrow(ContentIntegrityError)
  } finally {
    evidenceStore.close()
  }
})
