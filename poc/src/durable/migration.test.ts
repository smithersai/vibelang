import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  Action,
  compileDurableSource,
  CoordinatorCrash,
  Deployment,
  digest,
  DurableExecutor,
  DurableStore,
  ExecutionMigratedError,
  Flow,
  MigrationRejectedError,
  PlanArtifact,
  planExecutionMigration,
  Provider,
  Worker,
  type BuiltDeployment,
  type JsonValue,
  type MigrationRejectionReason,
  type PlanNode
} from "./index.ts"

const temporaryDatabase = async (body: (filename: string) => Promise<void>): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), "smithers-durable-migration-"))
  const filename = join(directory, "state.sqlite")
  try {
    await body(filename)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** Models a process disappearing after SQLite returned from a named COMMIT. */
const crashAfterCommit = (
  store: DurableStore,
  point: string,
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
  }) as DurableStore
}

const First = Action.define<{ value: number }, { doubled: number }>({
  id: "test/Migration/First",
  version: 1
})

/**
 * Two Action versions of the same identity. Migration is exactly the operation
 * that lets an in-flight execution move from one to the other for work it has
 * not yet committed.
 */
const SecondV1 = Action.define<{ doubled: number }, { label: string }>({
  id: "test/Migration/Second",
  version: 1
})
const SecondV2 = Action.define<{ doubled: number }, { label: string }>({
  id: "test/Migration/Second",
  version: 2
})

interface Fixture {
  readonly deployment: BuiltDeployment<{ value: number }, { label: string }>
  readonly calls: { first: number; second: number }
}

const fixture = (options: {
  readonly id: string
  readonly second: typeof SecondV1
  readonly implementationVersion: string
  readonly firstPoisoned?: boolean
  readonly label?: string
}): Fixture => {
  const calls = { first: 0, second: 0 }
  const Program = Flow.define<{ value: number }, { label: string }>(
    { id: "test/MigrationFlow", version: 1 },
    (input) => {
      const doubled = First.run({ value: input.value })
      return options.second.run({ doubled: doubled.doubled })
    }
  )
  const FirstLive = Provider.provide(First, ({ value }) => {
    calls.first += 1
    if (options.firstPoisoned === true) {
      throw new Error("committed Action re-invoked after migration")
    }
    return { doubled: value * 2 }
  }, {
    implementationId: "migration-first",
    implementationVersion: options.implementationVersion,
    recovery: { mode: "repeatable", maxAttempts: 3 },
    reuse: { kind: "execution" }
  })
  const SecondLive = Provider.provide(options.second, ({ doubled }) => {
    calls.second += 1
    return { label: `${options.label ?? "v1"}:${doubled}` }
  }, {
    implementationId: "migration-second",
    implementationVersion: options.implementationVersion,
    recovery: { mode: "repeatable", maxAttempts: 3 },
    reuse: { kind: "execution" }
  })
  return {
    calls,
    deployment: Deployment.build({
      id: options.id,
      flow: Program,
      pools: [Worker.pool("local", { target: "typescript-bun", providers: [FirstLive, SecondLive] })]
    })
  }
}

/** Runs until the first node success commits, then simulates process death. */
const runUntilFirstCommit = async (
  deployment: Fixture["deployment"],
  filename: string,
  executionId: string
): Promise<void> => {
  const store = new DurableStore(filename)
  const crashing = crashAfterCommit(store, "commitSuccess", (result) => result === true)
  const executor = new DurableExecutor(deployment, crashing)
  await expect(executor.execute({ value: 21 }, {
    executionId,
    deadline: Date.now() + 30_000
  })).rejects.toBeInstanceOf(CoordinatorCrash)
  store.close()
}

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(5)
  }
}

const rejectionReason = (body: () => unknown): MigrationRejectionReason => {
  try {
    body()
  } catch (error) {
    if (error instanceof MigrationRejectedError) return error.reason
    throw error
  }
  throw new Error("expected a MigrationRejectedError")
}

test("an explicit migration resumes committed history under a new Plan without re-running committed Actions", async () => {
  await temporaryDatabase(async (filename) => {
    const before = fixture({ id: "migration-before", second: SecondV1, implementationVersion: "1" })
    await runUntilFirstCommit(before.deployment, filename, "run-migrate")
    expect(before.calls.first).toBe(1)
    expect(before.calls.second).toBe(0)

    // The target deployment changes the not-yet-committed Action's version and
    // implementation, and POISONS the already-committed one: if migration ever
    // replayed committed history under the new code, this would throw.
    const after = fixture({
      id: "migration-after",
      second: SecondV2,
      implementationVersion: "2",
      firstPoisoned: true,
      label: "v2"
    })
    expect(after.deployment.flow.plan.digest).not.toBe(before.deployment.flow.plan.digest)

    const store = new DurableStore(filename)
    const executor = new DurableExecutor(after.deployment, store)
    const applied = executor.migrate("run-migrate", before.deployment)
    expect(applied.applied).toBe(true)
    expect(applied.generation).toBe(1)
    expect(applied.fencedNodeIds).toEqual([])

    const output = await executor.resume("run-migrate", { deadline: Date.now() + 30_000 }).result()
    expect(output).toEqual({ label: "v2:42" })
    expect(after.calls.first).toBe(0) // the poison provider was never invoked
    expect(after.calls.second).toBe(1)

    const journal = store.journal("run-migrate")
    const migrated = journal.find((event) => event.type === "execution_migrated")
    expect(migrated?.payload).toMatchObject({
      fromPlanDigest: before.deployment.flow.plan.digest,
      toPlanDigest: after.deployment.flow.plan.digest,
      fromManifestDigest: before.deployment.manifest.digest,
      toManifestDigest: after.deployment.manifest.digest
    })
    // Committed history is appended to, never rewritten.
    expect(journal[0]!.type).toBe("execution_started")
    expect(journal.filter((event) => event.type === "node_succeeded")).toHaveLength(2)
    expect(store.getExecution("run-migrate").status).toBe("completed")
    store.close()
  })
})

test("a manifest-only migration re-routes uncommitted work while the Plan stays pinned", async () => {
  await temporaryDatabase(async (filename) => {
    const before = fixture({ id: "manifest-before", second: SecondV1, implementationVersion: "1" })
    await runUntilFirstCommit(before.deployment, filename, "run-manifest")

    const after = fixture({
      id: "manifest-after",
      second: SecondV1,
      implementationVersion: "9",
      firstPoisoned: true,
      label: "hotfix"
    })
    expect(after.deployment.flow.plan.digest).toBe(before.deployment.flow.plan.digest)
    expect(after.deployment.manifest.digest).not.toBe(before.deployment.manifest.digest)

    const store = new DurableStore(filename)
    const executor = new DurableExecutor(after.deployment, store)
    expect(executor.migrate("run-manifest", before.deployment).applied).toBe(true)
    expect(await executor.resume("run-manifest", { deadline: Date.now() + 30_000 }).result())
      .toEqual({ label: "hotfix:42" })
    expect(after.calls.first).toBe(0)
    store.close()
  })
})

test("migration is refused with the exact reason for every incompatible change", async () => {
  await temporaryDatabase(async (filename) => {
    const before = fixture({ id: "reject-before", second: SecondV1, implementationVersion: "1" })
    await runUntilFirstCommit(before.deployment, filename, "run-reject")
    const store = new DurableStore(filename)

    // A change to an ALREADY COMMITTED node's semantics.
    const FirstV2 = Action.define<{ value: number }, { doubled: number }>({
      id: "test/Migration/First",
      version: 2
    })
    const committedChange = Deployment.build({
      id: "reject-committed",
      flow: Flow.define<{ value: number }, { label: string }>(
        { id: "test/MigrationFlow", version: 1 },
        (input) => SecondV1.run({ doubled: FirstV2.run({ value: input.value }).doubled })
      ),
      pools: [Worker.pool("local", {
        target: "typescript-bun",
        providers: [
          Provider.provide(FirstV2, ({ value }) => ({ doubled: value * 2 }), {
            implementationId: "migration-first",
            implementationVersion: "2",
            recovery: { mode: "repeatable", maxAttempts: 3 },
            reuse: { kind: "execution" }
          }),
          Provider.provide(SecondV1, ({ doubled }) => ({ label: `x:${doubled}` }), {
            implementationId: "migration-second",
            implementationVersion: "2",
            recovery: { mode: "repeatable", maxAttempts: 3 },
            reuse: { kind: "execution" }
          })
        ]
      })]
    })
    expect(rejectionReason(() =>
      new DurableExecutor(committedChange, store).migrate("run-reject", before.deployment)
    )).toBe("committed-node-semantics-changed")

    // Removing a node orphans its durable row.
    const shorter = Deployment.build({
      id: "reject-shorter",
      flow: Flow.define<{ value: number }, { doubled: number }>(
        { id: "test/MigrationFlow", version: 1 },
        (input) => First.run({ value: input.value })
      ),
      pools: [Worker.pool("local", {
        target: "typescript-bun",
        providers: [
          Provider.provide(First, ({ value }) => ({ doubled: value * 2 }), {
            implementationId: "migration-first",
            implementationVersion: "1",
            recovery: { mode: "repeatable", maxAttempts: 3 },
            reuse: { kind: "execution" }
          })
        ]
      })]
    })
    expect(rejectionReason(() =>
      new DurableExecutor(shorter, store).migrate("run-reject", before.deployment)
    )).toBe("node-set-changed")

    // A different Flow identity is not a migration at all.
    const otherFlow = Deployment.build({
      id: "reject-other",
      flow: Flow.define<{ value: number }, { label: string }>(
        { id: "test/OtherFlow", version: 1 },
        (input) => SecondV1.run({ doubled: First.run({ value: input.value }).doubled })
      ),
      pools: [Worker.pool("local", {
        target: "typescript-bun",
        providers: [
          Provider.provide(First, ({ value }) => ({ doubled: value * 2 }), {
            implementationId: "migration-first",
            implementationVersion: "1",
            recovery: { mode: "repeatable", maxAttempts: 3 },
            reuse: { kind: "execution" }
          }),
          Provider.provide(SecondV1, ({ doubled }) => ({ label: `o:${doubled}` }), {
            implementationId: "migration-second",
            implementationVersion: "1",
            recovery: { mode: "repeatable", maxAttempts: 3 },
            reuse: { kind: "execution" }
          })
        ]
      })]
    })
    expect(rejectionReason(() => planExecutionMigration(
      { plan: before.deployment.flow.plan, manifest: before.deployment.manifest },
      { plan: otherFlow.flow.plan, manifest: otherFlow.manifest }
    ))).toBe("flow-identity-changed")

    // Nothing to apply.
    expect(rejectionReason(() =>
      new DurableExecutor(before.deployment, store).migrate("run-reject", before.deployment)
    )).toBe("no-op-migration")

    // The execution is not pinned to the migration's source deployment.
    const unrelated = fixture({ id: "reject-unrelated", second: SecondV2, implementationVersion: "7" })
    expect(rejectionReason(() =>
      new DurableExecutor(unrelated.deployment, store).migrate("run-reject", unrelated.deployment)
    )).toBe("no-op-migration")
    const third = fixture({ id: "reject-third", second: SecondV2, implementationVersion: "8" })
    expect(rejectionReason(() =>
      new DurableExecutor(third.deployment, store).migrate("run-reject", unrelated.deployment)
    )).toBe("pinned-digest-mismatch")

    // A terminal execution can never be migrated.
    const after = fixture({ id: "reject-after", second: SecondV2, implementationVersion: "2" })
    const finisher = new DurableExecutor(after.deployment, store)
    expect(finisher.migrate("run-reject", before.deployment).applied).toBe(true)
    await finisher.resume("run-reject", { deadline: Date.now() + 30_000 }).result()
    expect(rejectionReason(() =>
      new DurableExecutor(before.deployment, store).migrate("run-reject", after.deployment)
    )).toBe("terminal-execution")
    expect(rejectionReason(() => finisher.migrate("run-unknown", before.deployment)))
      .toBe("unknown-execution")
    store.close()
  })
})

test("the Flow input contract and pinned suspension contracts are frozen across a migration", () => {
  const compile = (text: string, id: string) => {
    const result = compileDurableSource(text, { fileName: `flows/${id}.sm.ts`, flowId: `test/${id}`, actions: [] })
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics))
    return result
  }
  const narrow = compile(`
    import { durable, waitSignal } from "smithers:flows"
    export const F = durable(function F(input: { requestId: string }) {
      return { requestId: input.requestId, decision: waitSignal<{ approved: boolean }>("approval.decided") }
    })
  `, "Contract")
  // Same Flow id, widened input contract.
  const widened = compileDurableSource(`
    import { durable, waitSignal } from "smithers:flows"
    export const F = durable(function F(input: { requestId: string; note: string }) {
      return { requestId: input.requestId, decision: waitSignal<{ approved: boolean }>("approval.decided") }
    })
  `, { fileName: "flows/Contract.sm.ts", flowId: "test/Contract", actions: [] })
  if (!widened.ok) throw new Error(JSON.stringify(widened.diagnostics))
  const narrowDeployment = Deployment.build({ id: "contract-a", flow: narrow.flow, pools: [] })
  const widenedDeployment = Deployment.build({ id: "contract-b", flow: widened.flow, pools: [] })
  expect(rejectionReason(() => planExecutionMigration(
    { plan: narrowDeployment.flow.plan, manifest: narrowDeployment.manifest },
    { plan: widenedDeployment.flow.plan, manifest: widenedDeployment.manifest }
  ))).toBe("flow-contract-changed")

  // Re-typing a pinned signal payload is deliberately out of scope: the store
  // pins that contract once at initialization and migration never re-pins it.
  const retyped = compileDurableSource(`
    import { durable, waitSignal } from "smithers:flows"
    export const F = durable(function F(input: { requestId: string }) {
      return { requestId: input.requestId, decision: waitSignal<{ approved: boolean; note: string }>("approval.decided") }
    })
  `, { fileName: "flows/Contract.sm.ts", flowId: "test/Contract", actions: [] })
  if (!retyped.ok) throw new Error(JSON.stringify(retyped.diagnostics))
  const retypedDeployment = Deployment.build({ id: "contract-c", flow: retyped.flow, pools: [] })
  const reason = rejectionReason(() => {
    const migration = planExecutionMigration(
      { plan: narrowDeployment.flow.plan, manifest: narrowDeployment.manifest },
      { plan: retypedDeployment.flow.plan, manifest: retypedDeployment.manifest }
    )
    const store = new DurableStore()
    try {
      new DurableExecutor(narrowDeployment, store)
        .start({ requestId: "r-1" }, { executionId: "contract-run", deadline: Date.now() + 200 })
      store.migrateExecution("contract-run", migration)
    } finally {
      store.close()
    }
  })
  // The Flow success contract also moves when the payload type moves, so the
  // Flow-level rule fires first; either judgment refuses the migration.
  expect(["flow-contract-changed", "pinned-contract-changed", "node-set-changed"]).toContain(reason)
})

test("a forged or self-inconsistent migration artifact is refused before anything commits", async () => {
  await temporaryDatabase(async (filename) => {
    const before = fixture({ id: "forge-before", second: SecondV1, implementationVersion: "1" })
    await runUntilFirstCommit(before.deployment, filename, "run-forge")
    const after = fixture({ id: "forge-after", second: SecondV2, implementationVersion: "2" })
    const store = new DurableStore(filename)
    const honest = planExecutionMigration(
      { plan: before.deployment.flow.plan, manifest: before.deployment.manifest },
      { plan: after.deployment.flow.plan, manifest: after.deployment.manifest }
    )

    // A migration whose claimed identity disagrees with its own artifacts.
    expect(rejectionReason(() => store.migrateExecution("run-forge", {
      ...honest,
      digest: "0".repeat(64)
    }))).toBe("pinned-digest-mismatch")

    // An edited Plan body no longer validates against its own semantic digest.
    expect(() => store.migrateExecution("run-forge", {
      ...honest,
      to: {
        ...honest.to,
        plan: { ...honest.to.plan, flowVersion: 99 }
      }
    })).toThrow(/Plan semantic digest mismatch/)

    // Nothing was applied by any of the refusals above.
    expect(store.journal("run-forge").some((event) => event.type === "execution_migrated")).toBe(false)

    // Claimed digest fields are evidence, not authority: the store re-derives
    // every one of them from the artifacts, so editing them changes nothing.
    const relabelled = store.migrateExecution("run-forge", {
      ...honest,
      fromPlanDigest: "1".repeat(64),
      toManifestDigest: "2".repeat(64)
    })
    expect(relabelled.applied).toBe(true)
    const migrated = store.journal("run-forge").find((event) => event.type === "execution_migrated")
    expect(migrated?.payload).toMatchObject({
      fromPlanDigest: before.deployment.flow.plan.digest,
      toPlanDigest: after.deployment.flow.plan.digest,
      toManifestDigest: after.deployment.manifest.digest
    })
    store.close()
  })
})

test("a migrated execution fences stale coordinators instead of letting them terminalize it", async () => {
  await temporaryDatabase(async (filename) => {
    const before = fixture({ id: "fence-before", second: SecondV1, implementationVersion: "1" })
    await runUntilFirstCommit(before.deployment, filename, "run-fence")
    const after = fixture({
      id: "fence-after",
      second: SecondV2,
      implementationVersion: "2",
      label: "v2"
    })

    const store = new DurableStore(filename)
    // A live attempt admitted under the old Plan, still holding its lease.
    const nodeId = after.deployment.flow.plan.nodes[1]!.id
    const claimed = store.claimNode("run-fence", nodeId, "stale-owner", 60_000)
    expect(claimed.kind).toBe("claimed")

    const migrated = new DurableExecutor(after.deployment, store).migrate("run-fence", before.deployment)
    expect(migrated.applied).toBe(true)
    expect(migrated.fencedNodeIds).toEqual([nodeId])
    // The fenced attempt cannot land its result under the new pinned code.
    if (claimed.kind !== "claimed") throw new Error("expected a claim")
    expect(store.commitSuccess("run-fence", nodeId, "stale-owner", claimed.fencingToken, { label: "stale" }))
      .toBe(false)

    // Every OTHER durable write a stale coordinator can reach is refused too,
    // not just the fenced commit above. `skipNodes` and `scheduleTimer` are in
    // this list because they were once the only two that were not: the first
    // writes the terminal, inverse-less `skipped`, and the second writes an
    // absolute wake deadline derived from a Plan this coordinator no longer
    // owns.
    const stalePlan = before.deployment.flow.plan.digest
    const staleWrites: readonly (readonly [string, () => unknown])[] = [
      ["claimNode", () => store.claimNode("run-fence", nodeId, "stale-owner", 1000, Date.now(), stalePlan)],
      ["timeoutNode", () => store.timeoutNode("run-fence", nodeId, "stale", stalePlan)],
      ["adoptSuccess", () => store.adoptSuccess("run-fence", nodeId, null, "stale", stalePlan)],
      ["completeExecution", () => store.completeExecution("run-fence", null, stalePlan)],
      ["failExecution", () => store.failExecution("run-fence", "defect", { name: "X" }, stalePlan)],
      ["skipNodes", () => store.skipNodes("run-fence", [nodeId], nodeId, "stale-owner", claimed.fencingToken, stalePlan)],
      ["scheduleTimer", () => store.scheduleTimer("run-fence", nodeId, 60_000, Date.now(), stalePlan)]
    ]
    for (const [name, write] of staleWrites) {
      expect(() => write(), `${name} must refuse a stale coordinator`).toThrow(ExecutionMigratedError)
    }
    // None of them left a mark: the node is still the un-terminalised, fenced
    // row the migration produced.
    expect(store.getNode("run-fence", nodeId).status).toBe("pending")
    expect(store.getNode("run-fence", nodeId).wakeAt).toBeUndefined()
    expect(store.journal("run-fence").some((event) => event.type === "node_skipped")).toBe(false)

    // The stale coordinator abandons the execution and does NOT fail it.
    const stale = new DurableExecutor(before.deployment, store)
    await expect(stale.resume("run-fence", { deadline: Date.now() + 30_000 }).result())
      .rejects.toBeInstanceOf(ExecutionMigratedError)
    expect(store.getExecution("run-fence").status).toBe("running")

    const executor = new DurableExecutor(after.deployment, store)
    expect(await executor.resume("run-fence", { deadline: Date.now() + 30_000 }).result())
      .toEqual({ label: "v2:42" })
    store.close()
  })
})

test("a crash immediately after the migration COMMIT converges on one applied migration", async () => {
  await temporaryDatabase(async (filename) => {
    const before = fixture({ id: "crash-before", second: SecondV1, implementationVersion: "1" })
    await runUntilFirstCommit(before.deployment, filename, "run-crash")
    const after = fixture({
      id: "crash-after",
      second: SecondV2,
      implementationVersion: "2",
      firstPoisoned: true,
      label: "v2"
    })

    const firstStore = new DurableStore(filename)
    const crashing = crashAfterCommit(
      firstStore,
      "migrateExecution",
      (result) => (result as { applied?: unknown }).applied === true
    )
    expect(() => new DurableExecutor(after.deployment, crashing).migrate("run-crash", before.deployment))
      .toThrow(CoordinatorCrash)
    firstStore.close()

    // A fresh process re-applies the same migration idempotently.
    const store = new DurableStore(filename)
    const executor = new DurableExecutor(after.deployment, store)
    const replay = executor.migrate("run-crash", before.deployment)
    expect(replay.applied).toBe(false)
    expect(replay.generation).toBe(1)
    expect(store.journal("run-crash").filter((event) => event.type === "execution_migrated")).toHaveLength(1)
    expect(await executor.resume("run-crash", { deadline: Date.now() + 30_000 }).result())
      .toEqual({ label: "v2:42" })
    expect(after.calls.first).toBe(0)
    store.close()
  })
})

test("two connections racing one migration produce exactly one applied winner", async () => {
  await temporaryDatabase(async (filename) => {
    const before = fixture({ id: "race-before", second: SecondV1, implementationVersion: "1" })
    await runUntilFirstCommit(before.deployment, filename, "run-race")
    const after = fixture({ id: "race-after", second: SecondV2, implementationVersion: "2" })

    const left = new DurableStore(filename)
    const right = new DurableStore(filename)
    const results = [
      new DurableExecutor(after.deployment, left).migrate("run-race", before.deployment),
      new DurableExecutor(after.deployment, right).migrate("run-race", before.deployment)
    ]
    expect(results.filter((entry) => entry.applied)).toHaveLength(1)
    expect(results.every((entry) => entry.generation === 1)).toBe(true)
    expect(left.journal("run-race").filter((event) => event.type === "execution_migrated")).toHaveLength(1)
    left.close()
    right.close()
  })
})

/**
 * Two Plans that differ only in a branch condition literal: identical node id
 * set, identical kinds, so the migration is legitimately compatible. Built from
 * the Plan IR rather than the authoring DSL because `Flow.branch` folds a
 * literal condition at authoring time and never emits a branch node.
 */
const branchDeployment = (condition: boolean) => {
  const left: PlanNode = {
    kind: "parallel",
    id: "n-left",
    outputs: [{ kind: "literal", value: "LEFT" }],
    dependencies: [],
    controlDependencies: []
  }
  const right: PlanNode = {
    kind: "parallel",
    id: "n-right",
    outputs: [{ kind: "literal", value: "RIGHT" }],
    dependencies: [],
    controlDependencies: []
  }
  const branch: PlanNode = {
    kind: "branch",
    id: "n-branch",
    condition: { kind: "literal", value: condition },
    whenTrue: { nodes: [left], output: { kind: "node", nodeId: "n-left", path: [] } },
    whenFalse: { nodes: [right], output: { kind: "node", nodeId: "n-right", path: [] } },
    dependencies: [],
    controlDependencies: []
  }
  const semantic = {
    formatVersion: 1 as const,
    flowId: "test/MigrationBranchFlow",
    flowVersion: 1,
    nodes: [branch],
    output: { kind: "node" as const, nodeId: "n-branch", path: [] as readonly string[] },
    requirements: [] as readonly string[],
    actions: [] as const
  }
  const plan = PlanArtifact.validate({ ...semantic, digest: digest(semantic) })
  const flow = PlanArtifact.load<Record<string, never>, unknown>(PlanArtifact.encode(plan))
  return { plan, deployment: Deployment.build({ id: "migration-branch", flow, pools: [] }) }
}

/**
 * The same two-arm Plan, but the arm `whenTrue` takes parks the execution: a
 * long timer, then a node that stays `pending` behind it. That is the steady
 * state this test's second half needs — a branch that has ALREADY committed its
 * skip and stays `running` for the whole lifetime of the arm it chose — and it
 * carries a node (`n-after`) that is legitimately still free to move, so the
 * rejection below can be shown to be about the decision and not about freezing
 * the branch's whole subtree.
 */
const parkedBranchDeployment = (condition: boolean, tail: string, waitMs = 1_500) => {
  const wait: PlanNode = {
    kind: "timer",
    id: "n-wait",
    durationMs: { kind: "literal", value: waitMs },
    dependencies: [],
    controlDependencies: []
  }
  const after: PlanNode = {
    kind: "parallel",
    id: "n-after",
    outputs: [{ kind: "literal", value: tail }],
    dependencies: [],
    controlDependencies: ["n-wait"]
  }
  const right: PlanNode = {
    kind: "parallel",
    id: "n-right",
    outputs: [{ kind: "literal", value: "RIGHT" }],
    dependencies: [],
    controlDependencies: []
  }
  const branch: PlanNode = {
    kind: "branch",
    id: "n-branch",
    condition: { kind: "literal", value: condition },
    whenTrue: { nodes: [wait, after], output: { kind: "node", nodeId: "n-after", path: [] } },
    whenFalse: { nodes: [right], output: { kind: "node", nodeId: "n-right", path: [] } },
    dependencies: [],
    controlDependencies: []
  }
  const semantic = {
    formatVersion: 1 as const,
    flowId: "test/MigrationParkedBranchFlow",
    flowVersion: 1,
    nodes: [branch],
    output: { kind: "node" as const, nodeId: "n-branch", path: [] as readonly string[] },
    requirements: [] as readonly string[],
    actions: [] as const
  }
  const plan = PlanArtifact.validate({ ...semantic, digest: digest(semantic) })
  const flow = PlanArtifact.load<Record<string, never>, unknown>(PlanArtifact.encode(plan))
  return { plan, deployment: Deployment.build({ id: "migration-parked-branch", flow, pools: [] }) }
}

test("a migration landing inside a branch attempt cannot skip a node the new Plan needs", async () => {
  await temporaryDatabase(async (filename) => {
    // `skipped` is terminal and has no inverse transition, so a stale
    // coordinator writing one into the arm the NEW Plan takes would strand the
    // execution permanently. The window is real: `resolveNodeUnshared` awaits
    // its branch claim, and another connection can commit a migration inside
    // that boundary.
    const takesLeft = branchDeployment(true)
    const takesRight = branchDeployment(false)
    const migration = planExecutionMigration(
      { plan: takesLeft.plan, manifest: takesLeft.deployment.manifest },
      { plan: takesRight.plan, manifest: takesRight.deployment.manifest }
    )

    const store = new DurableStore(filename)
    const operator = new DurableStore(filename)
    let migrated = false
    const racing = new Proxy(store, {
      get(target, property) {
        const value = Reflect.get(target, property, target)
        if (typeof value !== "function") return value
        return (...args: unknown[]) => {
          const result = Reflect.apply(value, target, args)
          // Land the migration in the exact `acquire` -> `skipNodes` window.
          if (!migrated && property === "claimNode" && (result as { kind?: unknown }).kind === "claimed") {
            migrated = true
            expect(operator.migrateExecution("run-branch", migration).fencedNodeIds).toEqual(["n-branch"])
          }
          return result
        }
      }
    }) as DurableStore

    await expect(new DurableExecutor(takesLeft.deployment, racing).execute(
      {},
      { executionId: "run-branch", leaseMs: 500 }
    )).rejects.toBeInstanceOf(ExecutionMigratedError)

    // The stale coordinator wrote nothing at all.
    expect(store.getNode("run-branch", "n-right").status).toBe("pending")
    expect(store.getNode("run-branch", "n-left").status).toBe("pending")
    expect(store.journal("run-branch").some((event) => event.type === "node_skipped")).toBe(false)

    // ... and the migrated coordinator still owns a complete, runnable
    // execution that takes the arm its own Plan declares.
    expect(await new DurableExecutor(takesRight.deployment, operator).execute(
      {},
      { executionId: "run-branch", leaseMs: 500 }
    )).toEqual(["RIGHT"])
    expect(operator.getExecution("run-branch").status).toBe("completed")
    expect(operator.getNode("run-branch", "n-left").status).toBe("skipped")
    expect(operator.getNode("run-branch", "n-right").status).toBe("succeeded")
    store.close()
    operator.close()
  })

  // The OTHER side of the same property, and the one this test's name has always
  // claimed: the window immediately AFTER `skipNodes` returns, where the skip is
  // already committed. That is not a race at all — the branch stays `running`
  // for the entire lifetime of the arm it chose, so it is the steady state of
  // any execution parked inside a branch, reachable by a plain operator
  // `migrate()` with no instrumentation whatsoever.
  await temporaryDatabase(async (filename) => {
    const takesLeft = parkedBranchDeployment(true, "TAIL")
    const takesRight = parkedBranchDeployment(false, "TAIL")
    const store = new DurableStore(filename)
    const operator = new DurableStore(filename)
    const handle = new DurableExecutor(takesLeft.deployment, store).start({}, {
      executionId: "run-parked",
      deadline: Date.now() + 20_000,
      leaseMs: 2_000
    })
    handle.result().catch(() => {})
    await waitFor(() => store.getNode("run-parked", "n-right").status === "skipped", "the committed skip")
    expect(store.getNode("run-parked", "n-branch").status).toBe("running")

    // The arm decision is committed durable evidence with no inverse, so the
    // Plan that would send the resume into the arm it already skipped is
    // refused — with `applied` never becoming true and nothing fenced.
    expect(() => new DurableExecutor(takesRight.deployment, operator).migrate("run-parked", takesLeft.deployment))
      .toThrow(MigrationRejectedError)
    expect(rejectionReason(() =>
      new DurableExecutor(takesRight.deployment, operator).migrate("run-parked", takesLeft.deployment)))
      .toBe("committed-node-semantics-changed")
    expect(operator.database.query("SELECT plan_digest,plan_generation FROM durable_executions WHERE id=?")
      .get("run-parked")).toEqual({ plan_digest: takesLeft.plan.digest, plan_generation: 0 })
    expect(operator.journal("run-parked").some((event) => event.type === "execution_migrated")).toBe(false)

    // BOTH DIRECTIONS, part one: the refusal is about the DECISION, not about
    // freezing the branch's whole subtree. `n-after` is still `pending` inside
    // the arm the branch took, and a migration that only changes it — the exact
    // edit migration exists to permit — still applies and still completes.
    const retailed = parkedBranchDeployment(true, "RETAILED")
    const applied = new DurableExecutor(retailed.deployment, operator)
      .migrate("run-parked", takesLeft.deployment)
    expect(applied.applied).toBe(true)
    await expect(handle.result()).rejects.toBeInstanceOf(ExecutionMigratedError)
    expect(await new DurableExecutor(retailed.deployment, operator).execute({}, {
      executionId: "run-parked",
      deadline: Date.now() + 20_000,
      leaseMs: 2_000
    })).toEqual(["RETAILED"])
    expect(operator.getExecution("run-parked").status).toBe("completed")
    expect(operator.getNode("run-parked", "n-right").status).toBe("skipped")
    store.close()
    operator.close()
  })

  // BOTH DIRECTIONS, part two: an UNDECIDED branch is not frozen at all. The
  // same condition flip that was refused above applies cleanly before any arm
  // node is terminal, and the execution then runs the arm the new Plan declares.
  await temporaryDatabase(async (filename) => {
    const takesLeft = branchDeployment(true)
    const takesRight = branchDeployment(false)
    const store = new DurableStore(filename)
    store.initializeExecution("run-undecided", takesLeft.plan, takesLeft.deployment.manifest, {})
    expect(new DurableExecutor(takesRight.deployment, store)
      .migrate("run-undecided", takesLeft.deployment).applied).toBe(true)
    expect(await new DurableExecutor(takesRight.deployment, store).execute({}, {
      executionId: "run-undecided",
      leaseMs: 500
    })).toEqual(["RIGHT"])
    expect(store.getNode("run-undecided", "n-left").status).toBe("skipped")
    store.close()
  })
})

test("an unraced branch still skips its untaken arm, and a lost branch attempt skips nothing", async () => {
  await temporaryDatabase(async (filename) => {
    const takesLeft = branchDeployment(true)
    const store = new DurableStore(filename)
    expect(await new DurableExecutor(takesLeft.deployment, store).execute(
      {},
      { executionId: "run-plain", leaseMs: 500 }
    )).toEqual(["LEFT"])
    expect(store.getNode("run-plain", "n-right").status).toBe("skipped")
    expect(store.journal("run-plain").filter((event) => event.type === "node_skipped")).toHaveLength(1)

    // The skip carries the branch attempt's identity, so an attempt that lost
    // its fence writes nothing rather than terminalizing a live node.
    store.initializeExecution("run-fenced", takesLeft.plan, takesLeft.deployment.manifest, {})
    const claim = store.claimNode("run-fenced", "n-branch", "owner-1", 60_000, Date.now(), takesLeft.plan.digest)
    if (claim.kind !== "claimed") throw new Error("expected a claim")
    expect(store.skipNodes("run-fenced", ["n-right"], "n-branch", "owner-2", claim.fencingToken, takesLeft.plan.digest))
      .toBe(false)
    expect(store.skipNodes("run-fenced", ["n-right"], "n-branch", "owner-1", claim.fencingToken + 1, takesLeft.plan.digest))
      .toBe(false)
    expect(store.getNode("run-fenced", "n-right").status).toBe("pending")
    // The live attempt still skips.
    expect(store.skipNodes("run-fenced", ["n-right"], "n-branch", "owner-1", claim.fencingToken, takesLeft.plan.digest))
      .toBe(true)
    expect(store.getNode("run-fenced", "n-right").status).toBe("skipped")
    store.close()
  })
})

const FanItem = Action.define<{ id: string }, { id: string }>({
  id: "test/Migration/FanItem",
  version: 1
})

const fanOutDeployment = (items: readonly { readonly id: string }[]) => {
  const node: PlanNode = {
    kind: "fanout",
    id: "n-fan",
    items: { kind: "literal", value: items as unknown as JsonValue },
    keyPath: ["id"],
    actionId: FanItem.descriptor.id,
    actionVersion: FanItem.descriptor.version,
    actionContractDigest: FanItem.descriptor.contractDigest,
    input: { kind: "item", path: [] },
    dependencies: [],
    controlDependencies: []
  }
  const semantic = {
    formatVersion: 1 as const,
    flowId: "test/MigrationFanOutFlow",
    flowVersion: 1,
    nodes: [node],
    output: { kind: "node" as const, nodeId: "n-fan", path: [] as readonly string[] },
    requirements: [FanItem.descriptor.id] as readonly string[],
    actions: [FanItem.descriptor]
  }
  const plan = PlanArtifact.validate({ ...semantic, digest: digest(semantic) })
  const flow = PlanArtifact.load<Record<string, never>, unknown>(PlanArtifact.encode(plan))
  const Live = Provider.provide(FanItem, ({ id }) => ({ id }), {
    implementationId: "migration-fan-item",
    implementationVersion: "1"
  })
  return {
    plan,
    deployment: Deployment.build({
      id: "migration-fan",
      flow,
      pools: [Worker.pool("local", { target: "typescript-bun", providers: [Live] })]
    })
  }
}

/** Crashes the coordinator right after `materializeFanOut` commits. */
const crashAfterMaterialization = async (
  deployment: ReturnType<typeof fanOutDeployment>["deployment"],
  filename: string,
  executionId: string
): Promise<void> => {
  const store = new DurableStore(filename)
  await expect(new DurableExecutor(deployment, crashAfterCommit(store, "materializeFanOut")).execute(
    {},
    { executionId, leaseMs: 300 }
  )).rejects.toBeInstanceOf(CoordinatorCrash)
  store.close()
}

test("a fan-out that materialized zero items is still committed durable evidence", async () => {
  await temporaryDatabase(async (filename) => {
    // Ordinary crash recovery: the materialization committed, the parent's own
    // success did not. The empty fan-out commits `fanout_digest` with ZERO item
    // rows, so evidence derived from the item rows cannot see it — and the
    // migration it then permits is unrecoverable, because the next resume
    // re-derives a different entry set and raises ContentIntegrityError.
    const empty = fanOutDeployment([])
    const oneItem = fanOutDeployment([{ id: "a" }])
    const twoItems = fanOutDeployment([{ id: "a" }, { id: "b" }])

    await crashAfterMaterialization(empty.deployment, filename, "run-empty")
    const emptyStore = new DurableStore(filename)
    expect(emptyStore.getNode("run-empty", "n-fan").status).toBe("pending")
    expect(emptyStore.database.query(
      "SELECT COUNT(*) AS count FROM durable_fanout_items WHERE execution_id='run-empty'"
    ).get()).toEqual({ count: 0 })
    expect(rejectionReason(() => emptyStore.migrateExecution(
      "run-empty",
      planExecutionMigration(
        { plan: empty.plan, manifest: empty.deployment.manifest },
        { plan: oneItem.plan, manifest: oneItem.deployment.manifest }
      )
    ))).toBe("committed-node-semantics-changed")
    // Refused, so the execution is still exactly where the crash left it.
    expect(emptyStore.getExecution("run-empty").status).toBe("running")

    // The non-empty case must keep refusing for the SAME reason: same evidence
    // class, same crash point, one item's difference.
    await crashAfterMaterialization(oneItem.deployment, filename, "run-one")
    expect(rejectionReason(() => emptyStore.migrateExecution(
      "run-one",
      planExecutionMigration(
        { plan: oneItem.plan, manifest: oneItem.deployment.manifest },
        { plan: twoItems.plan, manifest: twoItems.deployment.manifest }
      )
    ))).toBe("committed-node-semantics-changed")

    // Both directions: ordinary crash recovery under the SAME Plan still
    // converges, empty fan-out included.
    expect(await new DurableExecutor(empty.deployment, emptyStore).execute(
      {},
      { executionId: "run-empty", leaseMs: 300 }
    )).toEqual([])
    expect(await new DurableExecutor(oneItem.deployment, emptyStore).execute(
      {},
      { executionId: "run-one", leaseMs: 300 }
    )).toEqual([{ id: "a" }])
    emptyStore.close()
  })
})

const timerDeployment = (durationMs: number) => {
  const node: PlanNode = {
    kind: "timer",
    id: "n-timer",
    durationMs: { kind: "literal", value: durationMs },
    dependencies: [],
    controlDependencies: []
  }
  const semantic = {
    formatVersion: 1 as const,
    flowId: "test/MigrationTimerFlow",
    flowVersion: 1,
    nodes: [node],
    output: { kind: "node" as const, nodeId: "n-timer", path: [] as readonly string[] },
    requirements: [] as readonly string[],
    actions: [] as const
  }
  const plan = PlanArtifact.validate({ ...semantic, digest: digest(semantic) })
  const flow = PlanArtifact.load<Record<string, never>, null>(PlanArtifact.encode(plan))
  return { plan, deployment: Deployment.build({ id: "migration-timer", flow, pools: [] }) }
}

test("a timer's committed wake deadline is durable evidence; an unscheduled timer is not", async () => {
  await temporaryDatabase(async (filename) => {
    // `scheduleTimer` never recomputes a committed `wake_at`, so a migration
    // that changed `durationMs` under a scheduled timer would be accepted and
    // then silently discarded. Refusing it is the honest answer.
    const long = timerDeployment(60_000)
    const short = timerDeployment(5)
    const migration = planExecutionMigration(
      { plan: long.plan, manifest: long.deployment.manifest },
      { plan: short.plan, manifest: short.deployment.manifest }
    )
    const store = new DurableStore(filename)

    store.initializeExecution("run-scheduled", long.plan, long.deployment.manifest, {})
    expect(store.scheduleTimer("run-scheduled", "n-timer", 60_000, 1_000_000, long.plan.digest))
      .toEqual({ kind: "waiting", wakeAt: 1_060_000, newlyScheduled: true })
    expect(rejectionReason(() => store.migrateExecution("run-scheduled", migration)))
      .toBe("committed-node-semantics-changed")

    // Both directions: a timer that has NOT committed a deadline still
    // migrates, and the new duration is the one that lands.
    store.initializeExecution("run-unscheduled", long.plan, long.deployment.manifest, {})
    expect(store.migrateExecution("run-unscheduled", migration).applied).toBe(true)
    expect(store.scheduleTimer("run-unscheduled", "n-timer", 5, 1_000_000, short.plan.digest))
      .toEqual({ kind: "waiting", wakeAt: 1_000_005, newlyScheduled: true })

    // ... and an ordinary scheduled timer still runs to completion.
    expect(await new DurableExecutor(short.deployment, store).execute(
      {},
      { executionId: "run-timer", leaseMs: 500 }
    )).toBeNull()
    expect(store.getExecution("run-timer").status).toBe("completed")
    store.close()
  })
})
