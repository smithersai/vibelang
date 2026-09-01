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
  PlanArtifact,
  QueueEnqueueConflictError,
  QueueEnqueueRejectedError,
  queueContractIdentity,
  structuralSchema,
  type QueueNode
} from "./index.ts"

const source = `
import { durable, dequeue } from "smithers:flows"

throw new Error("durable queue lowering must not evaluate author code")

export const Consume = durable(function Consume(input: { worker: string }) {
  const job = dequeue<{ jobId: string; amount: number }>("jobs.pending")
  return { worker: input.worker, job: job }
})
`

const compileQueue = (text = source, id = "Consume") => compileDurableSource(text, {
  fileName: `flows/${id.toLowerCase()}.sm.ts`,
  flowId: `test/source/${id}`,
  flowVersion: 1,
  actions: []
})

const fixture = (id = "queue-deployment") => {
  const compiled = compileQueue()
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const node = allPlanNodes(compiled.plan).find((candidate): candidate is QueueNode => candidate.kind === "queue")
  if (node === undefined) throw new Error("expected a queue Plan node")
  return { compiled, node, deployment: Deployment.build({ id, flow: compiled.flow, pools: [] }) }
}

const unsafe = { unsafeLocalDelivery: true } as const

const item = (jobId: string, amount = 1) => ({ jobId, amount })

/** Deterministically corrupts the last character of an opaque hex token. */
const tamper = (token: string): string =>
  `${token.slice(0, -1)}${token.endsWith("0") ? "1" : "0"}`

const temporaryDatabase = async (body: (filename: string) => Promise<void>): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), "smithers-durable-queue-"))
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

test("compiler-owned queue lowering derives a stable item contract without evaluating author code", () => {
  const { compiled, node } = fixture()
  expect(compiled.plan.formatVersion).toBe(3)
  expect(compiled.plan.nodes).toHaveLength(1)
  expect(node.queueId).toBe("jobs.pending")
  expect(node.itemSchema.shape).toBe("structural")
  expect(node.itemSchema.source).toBe("compiler-derived")
  expect(node.itemSchema.descriptor).toEqual({
    kind: "object",
    fields: [
      { name: "amount", optional: false, value: { kind: "number" } },
      { name: "jobId", optional: false, value: { kind: "string" } }
    ]
  })
  expect(node.queueContractDigest).toBe(queueContractIdentity(node.queueId, node.itemSchema))
  expect(node.dependencies).toEqual([])

  // Node identity tolerates unrelated line shifts, like every other suspension.
  const shifted = compileQueue(`// unrelated leading edit\n${source}`)
  if (!shifted.ok) throw new Error(JSON.stringify(shifted.diagnostics))
  expect(allPlanNodes(shifted.plan).find((candidate) => candidate.kind === "queue")?.id).toBe(node.id)
})

test("queue source and artifact contracts fail closed for dynamic, spoofed, and forged uses", () => {
  const invalid = [
    `import { durable, dequeue } from "smithers:flows"
     export const F = durable(function F(input: { name: string }) { return dequeue<{ a: string }>(input.name) })`,
    `import { durable, dequeue } from "smithers:flows"
     export const F = durable(function F(input: {}) { return dequeue("jobs") })`,
    `import { durable, dequeue } from "smithers:flows"
     export const F = durable(function F(input: {}) { const indirect = dequeue; return indirect<{ a: string }>("jobs") })`,
    `import { durable, dequeue } from "smithers:flows"
     export const F = durable(function F(input: {}) { return dequeue<() => void>("jobs") })`,
    `import { durable } from "smithers:flows"
     function dequeue<T>(q: string): T { throw new Error(q) }
     export const F = durable(function F(input: {}) { return dequeue<string>("spoof") })`
  ]
  for (const [index, text] of invalid.entries()) {
    // `compileDurableFlow`, not `compileDurableSource`: since
    // `MIGRATION-PLAN.md` step 11 withdrew the Plan lowerer's walls, the Plan
    // compiler SIGNALS a body it has no shape for instead of refusing it, and
    // the entry point whose answer is a verdict is this one. Every spelling
    // here is still refused, and `SMITHERS4199` — the Effect Manifest refusing
    // to state a call it cannot account for — is inside the `SMITHERS41`
    // family the assertion below names.
    const result = compileDurableFlow(text, {
      fileName: `flows/invalid-queue-${index}.sm.ts`,
      flowId: `test/invalid-queue-${index}`,
      actions: []
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.diagnostics[0]!.code).toMatch(/^SMITHERS41/)
  }

  // Two different item types for one queue identity are ambiguous.
  const conflicting = compileDurableSource(`
    import { durable, dequeue } from "smithers:flows"
    export const F = durable(function F(input: {}) {
      const a = dequeue<{ id: string }>("jobs")
      const b = dequeue<{ id: number }>("jobs")
      return { a: a, b: b }
    })
  `, { fileName: "flows/conflicting-queue.sm.ts", flowId: "test/conflicting-queue", actions: [] })
  expect(conflicting.ok).toBe(false)
  if (!conflicting.ok) expect(conflicting.diagnostics[0]!.code).toBe("SMITHERS4123")

  const { compiled, node } = fixture()
  // A queue node smuggled into a version-2 artifact is rejected on version.
  const downgraded = {
    ...compiled.plan,
    formatVersion: 2,
    digest: undefined as unknown as string
  }
  const { digest: _drop, ...semantic } = downgraded
  expect(() => PlanArtifact.decode(PlanArtifact.encode({ ...semantic, digest: digest(semantic) } as never)))
    .toThrow(/queue nodes require Plan format version 3/)

  // A forged item schema no longer matches the pinned contract digest.
  const forgedSchema = structuralSchema("input", { kind: "string" })
  const forgedNodes = compiled.plan.nodes.map((candidate) =>
    candidate.id === node.id ? { ...candidate, itemSchema: forgedSchema } : candidate)
  const forged = { ...compiled.plan, nodes: forgedNodes }
  const { digest: _forgedDigest, ...forgedSemantic } = forged
  expect(() => PlanArtifact.decode(PlanArtifact.encode({
    ...forgedSemantic,
    digest: digest(forgedSemantic)
  } as never))).toThrow(/queue contract digest mismatch/)
})

test("a queue consumer suspends without a worker lease and consumes exactly one item", async () => {
  const { deployment, node } = fixture()
  const store = new DurableStore()
  const executor = new DurableExecutor(deployment, store)
  const handle = executor.start({ worker: "w-1" }, {
    executionId: "queue-run",
    deadline: Date.now() + 20_000
  })
  await waitFor(
    () => store.journal("queue-run").some((event) => event.type === "queue_waiting"),
    "queue_waiting"
  )
  // Suspension holds attempt zero, no owner, and no lease.
  const waiting = store.database.query(
    "SELECT status,attempt,owner,lease_until,queue_waiting_at FROM durable_nodes WHERE execution_id=? AND node_id=?"
  ).get("queue-run", node.id) as {
    status: string
    attempt: number
    owner: string | null
    lease_until: number | null
    queue_waiting_at: number | null
  }
  expect(waiting).toMatchObject({ status: "pending", attempt: 0, owner: null, lease_until: null })
  expect(waiting.queue_waiting_at).not.toBeNull()
  expect(() => store.claimNode("queue-run", node.id, "worker", 1_000))
    .toThrow(/cannot acquire a worker lease/)

  // FIFO is commit order.
  const grant = executor.grantQueue("jobs.pending")
  executor.enqueue({ queueId: "jobs.pending", idempotencyKey: "k-1", item: item("J1", 5) }, { producerToken: grant.producerToken })
  executor.enqueue({ queueId: "jobs.pending", idempotencyKey: "k-2", item: item("J2", 6) }, { producerToken: grant.producerToken })
  expect(await handle.result()).toEqual({ worker: "w-1", job: { jobId: "J1", amount: 5 } })

  const journal = store.journal("queue-run")
  const consumed = journal.find((event) => event.type === "queue_item_consumed")
  expect(consumed?.payload).toMatchObject({ queueId: "jobs.pending", sequence: 1, idempotencyKey: "k-1" })
  // The consume and the node success are one commit: they share a timestamp
  // and are adjacent in the journal.
  const consumeIndex = journal.findIndex((event) => event.type === "queue_item_consumed")
  expect(journal[consumeIndex + 1]!.type).toBe("node_succeeded")
  expect(journal[consumeIndex + 1]!.payload).toMatchObject({ coordinatorOwned: "queue" })

  // The second item is untouched and still pending.
  const remaining = store.database.query(
    "SELECT state,consumed_execution_id FROM durable_queue_items WHERE idempotency_key=?"
  ).get("k-2") as { state: string; consumed_execution_id: string | null }
  expect(remaining).toEqual({ state: "pending", consumed_execution_id: null })
  store.close()
})

test("enqueue is idempotent by key, fails closed on conflict, and rejects unauthorized producers", () => {
  const { deployment, node } = fixture("queue-enqueue")
  const store = new DurableStore()
  const executor = new DurableExecutor(deployment, store)
  executor.start({ worker: "w" }, { executionId: "enqueue-run", deadline: Date.now() + 300 })

  const grant = executor.grantQueue("jobs.pending")
  const first = executor.enqueue(
    { queueId: "jobs.pending", idempotencyKey: "same", item: item("J1", 1) },
    { producerToken: grant.producerToken }
  )
  const repeat = executor.enqueue(
    { queueId: "jobs.pending", idempotencyKey: "same", item: item("J1", 1) },
    { producerToken: grant.producerToken }
  )
  expect(first.duplicate).toBe(false)
  expect(repeat).toEqual({ ...first, duplicate: true })

  expect(() => executor.enqueue(
    { queueId: "jobs.pending", idempotencyKey: "same", item: item("J2", 2) },
    { producerToken: grant.producerToken }
  )).toThrow(QueueEnqueueConflictError)

  // The item schema is the Plan's, never the producer's.
  expect(() => executor.enqueue(
    { queueId: "jobs.pending", idempotencyKey: "bad", item: { jobId: "J", amount: "many" } },
    { producerToken: grant.producerToken }
  )).toThrow(QueueEnqueueRejectedError)
  expect(() => executor.enqueue(
    { queueId: "jobs.pending", idempotencyKey: "bad", item: { jobId: "J", amount: 1, extra: true } },
    { producerToken: grant.producerToken }
  )).toThrow(QueueEnqueueRejectedError)

  // Authorization is fail-closed and precedes every read.
  expect(() => executor.enqueue({ queueId: "jobs.pending", idempotencyKey: "x", item: item("J") }))
    .toThrow(QueueEnqueueRejectedError)
  expect(() => executor.enqueue(
    { queueId: "jobs.pending", idempotencyKey: "x", item: item("J") },
    { producerToken: tamper(grant.producerToken) }
  )).toThrow(QueueEnqueueRejectedError)
  expect(() => executor.enqueue(
    { queueId: "jobs.pending", idempotencyKey: "x", item: item("J") },
    { producerToken: grant.producerToken, unsafeLocalDelivery: true } as never
  )).toThrow(TypeError)
  expect(() => executor.enqueue({ queueId: "unknown.queue", idempotencyKey: "x", item: item("J") }, { producerToken: grant.producerToken }))
    .toThrow(/does not address a queue in this deployment Plan/)
  expect(() => store.mintQueueToken("unknown.queue")).toThrow(QueueEnqueueRejectedError)

  // A producer cannot invent an item contract for an unpinned queue either.
  expect(() => store.enqueue(
    { queueId: "unpinned.queue", idempotencyKey: "x", item: item("J") },
    { queueId: "unpinned.queue", queueContractDigest: node.queueContractDigest },
    unsafe
  )).toThrow(QueueEnqueueRejectedError)
  store.close()
})

test("two coordinators racing one queue give the item to exactly one consumer", async () => {
  await temporaryDatabase(async (filename) => {
    const { deployment } = fixture("queue-race")
    const left = new DurableStore(filename)
    const right = new DurableStore(filename)
    const leftExecutor = new DurableExecutor(deployment, left)
    const rightExecutor = new DurableExecutor(deployment, right)

    // Two independent executions, one item: exactly one may win it.
    const a = leftExecutor.start({ worker: "a" }, { executionId: "race-a", deadline: Date.now() + 20_000 })
    const b = rightExecutor.start({ worker: "b" }, { executionId: "race-b", deadline: Date.now() + 20_000 })
    await waitFor(
      () =>
        left.journal("race-a").some((event) => event.type === "queue_waiting") &&
        right.journal("race-b").some((event) => event.type === "queue_waiting"),
      "both consumers waiting"
    )
    leftExecutor.enqueue(
      { queueId: "jobs.pending", idempotencyKey: "only", item: item("ONLY", 3) },
      { producerToken: leftExecutor.grantQueue("jobs.pending").producerToken }
    )
    const winner = await Promise.race([
      a.result().then((value) => ({ id: "race-a", value })),
      b.result().then((value) => ({ id: "race-b", value }))
    ])
    expect(winner.value).toMatchObject({ job: { jobId: "ONLY", amount: 3 } })

    const rows = left.database.query(
      "SELECT state,consumed_execution_id FROM durable_queue_items WHERE idempotency_key='only'"
    ).all() as readonly { state: string; consumed_execution_id: string | null }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.state).toBe("consumed")
    expect(rows[0]!.consumed_execution_id).toBe(winner.id)

    // The loser is still suspended, not holding a partially consumed item.
    const loserId = winner.id === "race-a" ? "race-b" : "race-a"
    const loserNode = left.database.query(
      "SELECT status FROM durable_nodes WHERE execution_id=? AND node_kind='queue'"
    ).get(loserId) as { status: string }
    expect(loserNode.status).toBe("pending")
    ;(winner.id === "race-a" ? rightExecutor : leftExecutor).cancel(loserId, { name: "Done", message: "done" })
    await expect((winner.id === "race-a" ? b : a).result()).rejects.toBeInstanceOf(DurableExecutionCancelled)
    left.close()
    right.close()
  })
})

test("cancellation and the persisted deadline both end a queue wait without consuming an item", async () => {
  const { deployment, node } = fixture("queue-cancel")
  const store = new DurableStore()
  const executor = new DurableExecutor(deployment, store)
  const handle = executor.start({ worker: "c" }, { executionId: "cancel-run", deadline: Date.now() + 20_000 })
  await waitFor(
    () => store.journal("cancel-run").some((event) => event.type === "queue_waiting"),
    "queue_waiting"
  )
  handle.cancel({ name: "Cancelled", message: "operator" })
  await expect(handle.result()).rejects.toBeInstanceOf(DurableExecutionCancelled)
  expect(store.getNode("cancel-run", node.id).status).toBe("cancelled")
  expect(store.database.query(
    "SELECT queue_waiting_at FROM durable_nodes WHERE execution_id=? AND node_id=?"
  ).get("cancel-run", node.id)).toEqual({ queue_waiting_at: null })

  const deadline = new DurableExecutor(deployment, store)
  await expect(deadline.execute({ worker: "d" }, {
    executionId: "deadline-run",
    deadline: Date.now() + 120,
    wakeupSweepMs: 20
  })).rejects.toBeInstanceOf(DurableActionDefect)
  expect(store.getNode("deadline-run", node.id).exit).toMatchObject({ kind: "defect" })
  // No item existed to consume, and the queue is untouched.
  expect(store.database.query("SELECT COUNT(*) AS count FROM durable_queue_items").get())
    .toEqual({ count: 0 })
  store.close()
})

test("a crash after the queue consume COMMIT adopts the item without re-consuming", async () => {
  await temporaryDatabase(async (filename) => {
    const { deployment, node } = fixture("queue-crash")
    const first = new DurableStore(filename)
    const executor = new DurableExecutor(deployment, first)

    const run = executor.execute({ worker: "x" }, {
      executionId: "crash-run",
      deadline: Date.now() + 20_000,
      afterNodeAdopted(nodeId) {
        if (nodeId === node.id) throw new CoordinatorCrash(nodeId)
      }
    })
    await waitFor(
      () => first.journal("crash-run").some((event) => event.type === "queue_waiting"),
      "queue_waiting"
    )
    executor.enqueue(
      { queueId: "jobs.pending", idempotencyKey: "crash-1", item: item("CRASH", 9) },
      { producerToken: executor.grantQueue("jobs.pending").producerToken }
    )
    // Death immediately after the consume COMMIT, before the value is exposed.
    await expect(run).rejects.toBeInstanceOf(CoordinatorCrash)
    first.close()

    const store = new DurableStore(filename)
    const resumed = new DurableExecutor(deployment, store)
    expect(await resumed.resume("crash-run", { deadline: Date.now() + 20_000 }).result())
      .toEqual({ worker: "x", job: { jobId: "CRASH", amount: 9 } })
    // The item was consumed exactly once, by exactly this node.
    const rows = store.database.query(
      "SELECT state,consumed_execution_id,consumed_node_id FROM durable_queue_items"
    ).all() as readonly { state: string; consumed_execution_id: string; consumed_node_id: string }[]
    expect(rows).toEqual([{ state: "consumed", consumed_execution_id: "crash-run", consumed_node_id: node.id }])
    expect(store.journal("crash-run").filter((event) => event.type === "queue_item_consumed")).toHaveLength(1)
    store.close()
  })
})

test("corrupt persisted queue state fails closed instead of replaying", () => {
  const { deployment, node } = fixture("queue-corrupt")
  const store = new DurableStore()
  const executor = new DurableExecutor(deployment, store)
  executor.start({ worker: "z" }, { executionId: "corrupt-run", deadline: Date.now() + 300 })
  executor.enqueue(
    { queueId: "jobs.pending", idempotencyKey: "c-1", item: item("C", 1) },
    { producerToken: executor.grantQueue("jobs.pending").producerToken }
  )
  const expectation = {
    planDigest: deployment.flow.plan.digest,
    manifestDigest: deployment.manifest.digest,
    queueId: node.queueId,
    queueContractDigest: node.queueContractDigest
  }

  store.database.query("UPDATE durable_queue_items SET item_digest=? WHERE idempotency_key='c-1'")
    .run("0".repeat(64))
  expect(() => store.pollQueue("corrupt-run", node.id, expectation)).toThrow(ContentIntegrityError)

  store.database.query("UPDATE durable_queues SET contract_digest=? WHERE queue_id=?")
    .run("0".repeat(64), node.queueId)
  expect(() => store.pollQueue("corrupt-run", node.id, expectation)).toThrow(ContentIntegrityError)

  // A coordinator claiming a different Plan contract is refused too.
  const other = new DurableStore()
  const otherExecutor = new DurableExecutor(deployment, other)
  otherExecutor.start({ worker: "z" }, { executionId: "corrupt-run", deadline: Date.now() + 300 })
  expect(() => other.pollQueue("corrupt-run", node.id, {
    ...expectation,
    queueContractDigest: "1".repeat(64)
  })).toThrow(ContentIntegrityError)
  expect(() => other.pollQueue("corrupt-run", node.id, {
    ...expectation,
    queueId: "other.queue"
  })).toThrow(ContentIntegrityError)
  store.close()
  other.close()
})

test("two Flows disagreeing about one queue's item contract fail closed at initialization", () => {
  const first = fixture("queue-agree-a")
  const second = compileDurableSource(`
    import { durable, dequeue } from "smithers:flows"
    export const Other = durable(function Other(input: { worker: string }) {
      return dequeue<{ jobId: number }>("jobs.pending")
    })
  `, { fileName: "flows/other.sm.ts", flowId: "test/source/Other", actions: [] })
  if (!second.ok) throw new Error(JSON.stringify(second.diagnostics))
  const store = new DurableStore()
  new DurableExecutor(first.deployment, store)
    .start({ worker: "a" }, { executionId: "agree-a", deadline: Date.now() + 200 })
  const conflicting = Deployment.build({ id: "queue-agree-b", flow: second.flow, pools: [] })
  expect(() => new DurableExecutor(conflicting, store).execute({ worker: "b" }, {
    executionId: "agree-b",
    deadline: Date.now() + 200
  })).toThrow(QueueEnqueueConflictError)
  expect(store.database.query("SELECT COUNT(*) AS count FROM durable_queues").get()).toEqual({ count: 1 })
  expect(canonicalJson(store.listChildExecutions("agree-a"))).toBe("[]")
  store.close()
})

test("a queue consumer holds no lease across restart and re-reads only persisted state", async () => {
  await temporaryDatabase(async (filename) => {
    const { deployment, node } = fixture("queue-restart")
    const first = new DurableStore(filename)
    const executor = new DurableExecutor(deployment, first)
    await expect(executor.execute({ worker: "r" }, {
      executionId: "restart-run",
      deadline: Date.now() + 20_000,
      afterQueueWaiting(nodeId) {
        throw new CoordinatorCrash(nodeId)
      }
    })).rejects.toBeInstanceOf(CoordinatorCrash)
    expect(first.getNode("restart-run", node.id).status).toBe("pending")
    first.close()

    const store = new DurableStore(filename)
    const resumed = new DurableExecutor(deployment, store)
    const handle = resumed.resume("restart-run", { deadline: Date.now() + 20_000 })
    resumed.enqueue(
      { queueId: "jobs.pending", idempotencyKey: "after-restart", item: item("R", 2) },
      { producerToken: resumed.grantQueue("jobs.pending").producerToken }
    )
    expect(await handle.result()).toEqual({ worker: "r", job: { jobId: "R", amount: 2 } })
    // Exactly one waiting record and one consume across the whole run.
    const types = store.journal("restart-run").map((event) => event.type)
    expect(types.filter((type) => type === "queue_waiting")).toHaveLength(1)
    expect(types.filter((type) => type === "queue_item_consumed")).toHaveLength(1)
    store.close()
  })
})
