import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  Action,
  compileDurableSource,
  CoordinatorCrash,
  Deployment,
  DurableExecutor,
  DurableStore,
  ExecutionMigratedError,
  Flow,
  MigrationRejectedError,
  planExecutionMigration,
  Provider,
  Worker,
  type BuiltDeployment,
  type MigrationRejectionReason
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
