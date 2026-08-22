import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  Action,
  Deployment,
  DurableStore,
  Flow,
  Provider,
  Worker,
} from "./index.ts"

/**
 * Real two-connection contention over one database file. Every read-then-write
 * store transaction opens with BEGIN IMMEDIATE, so a concurrent committed
 * writer resolves through the busy handler (a wait) instead of surfacing
 * SQLITE_BUSY_SNAPSHOT — an error the busy handler never retries and that a
 * DEFERRED read-then-write transaction is exposed to under WAL.
 */

const ITERATIONS = 48

const buildFixture = (suffix: string) => {
  const actions = [0, 1, 2].map((index) =>
    Action.define<{ value: number }, { value: number }>({ id: `test/Contention${suffix}${index}`, version: 1 })
  )
  const Program = Flow.define<{ value: number }, unknown>(
    { id: `test/ContentionFlow${suffix}`, version: 1 },
    (input) => actions.map((action) => action.run({ value: input.value })),
  )
  const providers = actions.map((action, index) => Provider.provide(action, ({ value }) => ({ value }), {
    implementationId: `contention-${suffix}-${index}`,
    implementationVersion: "1",
  }))
  const deployment = Deployment.build({
    id: `contention-${suffix}`,
    flow: Program,
    pools: [Worker.pool("local", { target: "typescript-bun", providers })],
  })
  const nodeIds = Program.plan.nodes.filter((node) => node.kind === "action").map((node) => node.id)
  return { plan: Program.plan, manifest: deployment.manifest, nodeIds }
}

interface HammerStats {
  claimed: number
  busy: number
  terminal: number
  fencedLoss: number
}

/**
 * Conflicting claim/retry/commit cycles against nodes another connection is
 * hammering at the same time. Millisecond leases keep every claim stealable,
 * so both sides write to the same rows continuously. Every outcome must be a
 * modeled result — a throw here is the defect this test exists to catch.
 */
const hammer = async (
  store: DurableStore,
  executionId: string,
  nodeIds: readonly string[],
  iterations: number,
  owner: string,
): Promise<HammerStats> => {
  const stats: HammerStats = { claimed: 0, busy: 0, terminal: 0, fencedLoss: 0 }
  for (let index = 0; index < iterations; index++) {
    const nodeId = nodeIds[index % nodeIds.length]!
    const claim = store.claimNode(executionId, nodeId, owner, 1, Date.now())
    if (claim.kind === "claimed") {
      stats.claimed++
      if (index < iterations / 2) {
        const kept = store.scheduleRetry(
          executionId,
          nodeId,
          owner,
          claim.fencingToken,
          { kind: "defect", defect: { name: "Contention", message: "handoff" } },
          Date.now(),
        )
        if (!kept) stats.fencedLoss++
      } else {
        const committed = store.commitSuccess(executionId, nodeId, owner, claim.fencingToken, { winner: owner })
        if (!committed) stats.fencedLoss++
      }
    } else if (claim.kind === "busy") {
      stats.busy++
    } else {
      stats.terminal++
    }
    if (index % 8 === 0) await Bun.sleep(0)
  }
  return stats
}

const runnerSource = (storeModulePath: string): string => `
import { DurableStore } from ${JSON.stringify(storeModulePath)}

const [database, executionId, nodesJson, iterationsText, owner] = process.argv.slice(2)
const nodeIds = JSON.parse(nodesJson)
const iterations = Number(iterationsText)
const store = new DurableStore(database)

process.stdout.write("ready\\n")
const reader = Bun.stdin.stream().getReader()
let barrier = ""
while (!barrier.includes("go")) {
  const { done, value } = await reader.read()
  if (done) break
  barrier += new TextDecoder().decode(value)
}

const stats = { claimed: 0, busy: 0, terminal: 0, fencedLoss: 0 }
for (let index = 0; index < iterations; index++) {
  const nodeId = nodeIds[index % nodeIds.length]
  const claim = store.claimNode(executionId, nodeId, owner, 1, Date.now())
  if (claim.kind === "claimed") {
    stats.claimed++
    if (index < iterations / 2) {
      const kept = store.scheduleRetry(
        executionId,
        nodeId,
        owner,
        claim.fencingToken,
        { kind: "defect", defect: { name: "Contention", message: "handoff" } },
        Date.now(),
      )
      if (!kept) stats.fencedLoss++
    } else {
      const committed = store.commitSuccess(executionId, nodeId, owner, claim.fencingToken, { winner: owner })
      if (!committed) stats.fencedLoss++
    }
  } else if (claim.kind === "busy") {
    stats.busy++
  } else {
    stats.terminal++
  }
  if (index % 8 === 0) await Bun.sleep(0)
}
store.close()
process.stdout.write(JSON.stringify(stats) + "\\n")
process.exit(0)
`

test("interleaved cross-connection claim/retry/commit cycles stay on modeled results and converge to one winner per node", async () => {
  if (process.platform === "win32") return
  const directory = mkdtempSync(join(tmpdir(), "vibe-durable-contention-"))
  try {
    const database = join(directory, "state.sqlite")
    const executionId = "contended"
    const { plan, manifest, nodeIds } = buildFixture("Parallel")
    expect(nodeIds.length).toBe(3)

    const store = new DurableStore(database)
    store.initializeExecution(executionId, plan, manifest, { value: 1 })

    const runnerPath = join(directory, "contention-runner.ts")
    writeFileSync(runnerPath, runnerSource(join(import.meta.dir, "store.ts")))
    const child = Bun.spawn([
      process.execPath,
      runnerPath,
      database,
      executionId,
      JSON.stringify(nodeIds),
      String(ITERATIONS),
      "child",
    ], {
      cwd: directory,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })

    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    let childOutput = ""
    while (!childOutput.includes("ready")) {
      const { done, value } = await reader.read()
      if (done) break
      childOutput += decoder.decode(value)
    }
    expect(childOutput).toContain("ready")

    // Both connections start hammering the same nodes at the same instant.
    child.stdin.write("go\n")
    await child.stdin.end()
    const drainRest = (async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        childOutput += decoder.decode(value)
      }
    })()

    // A SQLITE_BUSY_SNAPSHOT (or any other unmodeled throw) fails the test here.
    const parentStats = await hammer(store, executionId, nodeIds, ITERATIONS, "parent")

    const [exitCode] = await Promise.all([child.exited, drainRest])
    const stderr = await new Response(child.stderr).text()
    expect(stderr).toBe("")
    expect(exitCode).toBe(0)
    const childStats = JSON.parse(childOutput.split("\n").filter((line) => line.startsWith("{")).at(-1)!) as HammerStats

    // Every operation on both sides produced a modeled result.
    expect(parentStats.claimed + parentStats.busy + parentStats.terminal).toBe(ITERATIONS)
    expect(childStats.claimed + childStats.busy + childStats.terminal).toBe(ITERATIONS)
    expect(parentStats.claimed + childStats.claimed).toBeGreaterThan(0)

    // Drive every node to its terminal state, then verify exactly one winner.
    const closerDeadline = Date.now() + 5_000
    for (const nodeId of nodeIds) {
      while (store.getNode(executionId, nodeId).exit === undefined) {
        if (Date.now() > closerDeadline) throw new Error(`node ${nodeId} never converged`)
        const claim = store.claimNode(executionId, nodeId, "closer", 1_000, Date.now())
        if (claim.kind === "claimed") {
          store.commitSuccess(executionId, nodeId, "closer", claim.fencingToken, { winner: "closer" })
        } else if (claim.kind === "busy") {
          await Bun.sleep(2)
        }
      }
    }

    const events = store.journal(executionId)
    for (const nodeId of nodeIds) {
      const successes = events.filter((event) => event.type === "node_succeeded" && event.nodeId === nodeId)
      expect(successes.length).toBe(1)
      const exit = store.getNode(executionId, nodeId).exit!
      if (exit.kind !== "success") throw new Error(`node ${nodeId} ended as ${exit.kind}`)
      const winner = (exit.value as { winner: string }).winner
      expect(["parent", "child", "closer"]).toContain(winner)
    }
    store.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 30_000)

test("a second connection's steal fences out the first connection's in-flight attempt", () => {
  const directory = mkdtempSync(join(tmpdir(), "vibe-durable-fence-"))
  try {
    const database = join(directory, "state.sqlite")
    const executionId = "fenced"
    const { plan, manifest, nodeIds } = buildFixture("Fence")
    const nodeId = nodeIds[0]!

    const first = new DurableStore(database)
    const second = new DurableStore(database)
    first.initializeExecution(executionId, plan, manifest, { value: 1 })

    const now = Date.now()
    const held = first.claimNode(executionId, nodeId, "worker-a", 60_000, now)
    if (held.kind !== "claimed") throw new Error("expected the first connection to claim")

    // The lease expires; the second connection steals the running attempt.
    const stolen = second.claimNode(executionId, nodeId, "worker-b", 60_000, now + 61_000)
    if (stolen.kind !== "claimed") throw new Error("expected the second connection to steal")
    expect(stolen.stolen).toBe(true)
    expect(stolen.fencingToken).toBe(held.fencingToken + 1)

    // The fenced-out loser cannot commit, retry, or heartbeat its stale attempt.
    expect(first.commitSuccess(executionId, nodeId, "worker-a", held.fencingToken, { winner: "worker-a" })).toBe(false)
    expect(first.scheduleRetry(
      executionId,
      nodeId,
      "worker-a",
      held.fencingToken,
      { kind: "defect", defect: { name: "Fenced", message: "stale" } },
      now + 62_000,
    )).toBe(false)
    expect(first.heartbeat(executionId, nodeId, "worker-a", held.fencingToken, now + 120_000)).toBe(false)

    // The winner commits once; the loser's view converges to that result.
    expect(second.commitSuccess(executionId, nodeId, "worker-b", stolen.fencingToken, { winner: "worker-b" })).toBe(true)
    const exit = first.getNode(executionId, nodeId).exit
    expect(exit).toEqual({ kind: "success", value: { winner: "worker-b" }, adoptedFrom: null })
    expect(first.journal(executionId).filter((event) => event.type === "node_succeeded" && event.nodeId === nodeId).length).toBe(1)

    first.close()
    second.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
