import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DenoSubprocessSandbox } from "../agent/sandbox.ts"
import {
  Action,
  authenticateDeployment,
  compileActionContract,
  compileActionImplementationContract,
  compileDurableSource,
  createAuthenticatedDurableExecutor,
  createDenoIsolatedWorkerArtifact,
  DenoBundleWorker,
  DenoIsolatedWorker,
  Deployment,
  deploymentVerificationKey,
  DurableExecutor,
  DurableStore,
  encodeSignedDeploymentArtifact,
  generateDeploymentSigningKeyPair,
  generateWorkerTransportSecret,
  PlanArtifact,
  Provider,
  REMOTE_HTTP_SANDBOX,
  remoteHttpWorkerFactory,
  trustWorkerTransport,
  Worker,
  type ActionDescriptor,
  type Invocation,
  type WorkerHostEvent
} from "./index.ts"
import { runBundleInvocation, type LoadedBundleModule } from "./worker-host.ts"

/**
 * Every transport must agree about how long one Action attempt may run.
 *
 * The coordinator claims a node with `leaseMs`, then renews that lease in the
 * store every `leaseMs/3` for as long as the attempt runs. An Action that runs
 * longer than `leaseMs` is therefore completely ordinary. These tests pin that
 * ALL five worker transports reach the same verdict on exactly that Action, so
 * a deployment cannot succeed in-process and die on the remote transport.
 */

const LEASE_MS = 200
const DEADLINE_MS = 60_000
/** ~0.9s of arithmetic in both Bun and Deno; 4.5x the lease. */
const SPIN_ROUNDS = 250_000_000
/** The in-process host callback yields instead of spinning, so timers still fire. */
const SLEEP_MS = 900

const ACTION_ID = "test/lease-budget/Work"

const sandbox = (): DenoSubprocessSandbox => new DenoSubprocessSandbox({
  timeoutMs: 30_000,
  memoryMb: 128,
  maxOutputBytes: 256 * 1024,
  maxCalls: 1,
  maxConcurrentCalls: 1
})

const compileAction = (): ActionDescriptor => {
  const compiled = compileActionContract(`
import { Action } from "smithers:flows"
class Failed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Work extends Action<
  (input: { value: number, rounds: number }) => Result<{ value: number }, Failed>
> {}
`, { fileName: "lease-budget.sm", exportName: "Work", id: ACTION_ID, version: 1 })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  return compiled.descriptor
}

const descriptor = compileAction()
const WorkAction = Action.fromDescriptor<
  { value: number; rounds: number },
  { value: number },
  { code: string }
>(descriptor)

/** The in-process implementation: an ordinary slow Action that yields to the loop. */
const hostImplementation = async (input: { value: number; rounds: number }): Promise<{ value: number }> => {
  await Bun.sleep(SLEEP_MS)
  return { value: input.value + 1 }
}

const implementationContract = compileActionImplementationContract({
  action: descriptor,
  implementationId: "lease-budget-implementation",
  implementationVersion: "1",
  entryFile: "lease-budget.sm",
  exportName: "work",
  implementation: hostImplementation,
  sources: [{
    fileName: "lease-budget.sm",
    source: `
class Failed extends Error {
  constructor(readonly code: string) { super(code) }
}
export function work(input: { value: number, rounds: number }): Result<{ value: number }, Failed> {
  let total = 0
  for (let index = 0; index < input.rounds; index++) {
    total = (total + index) % 1000003
  }
  if (total < 0) throw new Failed("impossible")
  return { value: input.value + 1 }
}
`
  }]
})

const checkedProvider = () => Provider.provideChecked(WorkAction, hostImplementation, {
  implementationId: "lease-budget-implementation",
  implementationVersion: "1",
  implementationContract,
  recovery: { mode: "repeatable", maxAttempts: 1 }
})

const flowPlan = () => {
  const compiled = compileDurableSource(`
import { durable } from "smithers:flows"
import { Work } from "test:lease-budget-actions"
export const LeaseFlow = durable(function LeaseFlow(input: { value: number, rounds: number }) {
  return Work.run({ value: input.value, rounds: input.rounds })
})
`, {
    fileName: "flows/lease-budget.sm",
    flowId: "test/lease-budget/Flow",
    flowVersion: 1,
    actions: [Object.freeze({
      moduleSpecifier: "test:lease-budget-actions",
      exportName: "Work",
      descriptor
    })]
  })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  return PlanArtifact.load(PlanArtifact.encode(compiled.plan))
}

const runOptions = (executionId: string) => ({
  executionId,
  deadline: Date.now() + DEADLINE_MS,
  leaseMs: LEASE_MS
})

interface TransportOutcome {
  readonly transport: string
  readonly outcome: string
  readonly durationMs: number
}

const settle = async (
  transport: string,
  run: () => Promise<unknown>
): Promise<TransportOutcome> => {
  const started = Date.now()
  try {
    const value = await run()
    return { transport, outcome: `success:${JSON.stringify(value)}`, durationMs: Date.now() - started }
  } catch (error) {
    const defect = (error as { defect?: { name?: string; message?: string } }).defect
    const detail = defect !== undefined
      ? `${defect.name}: ${defect.message}`
      : error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    return { transport, outcome: `threw:${detail}`, durationMs: Date.now() - started }
  }
}

// ---------------------------------------------------------------------------
// transport 1: in-process LocalWorker
// ---------------------------------------------------------------------------

const runLocal = (): Promise<TransportOutcome> => settle("local", async () => {
  const deployment = Deployment.build({
    id: "lease-budget-local",
    flow: flowPlan(),
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [checkedProvider()] })]
  })
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    return await executor.execute({ value: 40, rounds: SPIN_ROUNDS }, runOptions("lease-budget-local"))
  } finally {
    store.close()
  }
})

// ---------------------------------------------------------------------------
// transport 2: DenoIsolatedWorker
// ---------------------------------------------------------------------------

const runIsolated = (): Promise<TransportOutcome> => settle("isolated", async () => {
  const isolated = sandbox()
  const artifact = createDenoIsolatedWorkerArtifact({
    poolId: "isolated",
    sandbox: isolated,
    functionExpression: `async (invocation) => {
      let total = 0
      for (let index = 0; index < invocation.input.rounds; index++) {
        total = (total + index) % 1000003
      }
      if (total < 0) return { kind: "defect", defect: { name: "Impossible", message: "impossible" } }
      return { kind: "success", value: { value: invocation.input.value + 1 } }
    }`
  })
  const provider = Provider.provide(WorkAction, hostImplementation, {
    implementationId: "lease-budget-isolated",
    implementationVersion: "1",
    dependencyDigests: [artifact.digest],
    recovery: { mode: "repeatable", maxAttempts: 1 }
  })
  const deployment = Deployment.build({
    id: "lease-budget-isolated",
    flow: flowPlan(),
    pools: [Worker.pool("isolated", {
      target: "typescript-deno",
      sandbox: isolated.kind,
      providers: [provider]
    })]
  })
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store, {
      workerFactory: (pool, manifest, providers) =>
        new DenoIsolatedWorker(pool, manifest, providers, { artifact, sandbox: isolated })
    })
    return await executor.execute({ value: 40, rounds: SPIN_ROUNDS }, runOptions("lease-budget-isolated"))
  } finally {
    store.close()
  }
})

// ---------------------------------------------------------------------------
// transport 3: DenoBundleWorker
// ---------------------------------------------------------------------------

const runBundle = (): Promise<TransportOutcome> => settle("bundle", async () => {
  const isolated = sandbox()
  const deployment = Deployment.build({
    id: "lease-budget-bundle",
    flow: flowPlan(),
    pools: [Worker.pool("deno-bundle", {
      target: "typescript-deno",
      sandbox: isolated.kind,
      bundle: true,
      providers: [checkedProvider()]
    })]
  })
  const bundle = deployment.bundles.get("deno-bundle")
  if (bundle === undefined) throw new Error("bundle pool emitted no bundle")
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store, {
      workerFactory: (pool, manifest, providers) =>
        new DenoBundleWorker(pool, manifest, providers, { bundle, sandbox: isolated })
    })
    return await executor.execute({ value: 40, rounds: SPIN_ROUNDS }, runOptions("lease-budget-bundle"))
  } finally {
    store.close()
  }
})

// ---------------------------------------------------------------------------
// transports 4 and 5: RemoteHttpWorker over an out-of-process worker host
// ---------------------------------------------------------------------------

const runRemote = (): Promise<TransportOutcome> => settle("remote", async () => {
  const deployment = Deployment.build({
    id: "lease-budget-remote",
    flow: flowPlan(),
    pools: [Worker.pool("remote", {
      target: "typescript-bun",
      sandbox: REMOTE_HTTP_SANDBOX,
      bundle: true,
      providers: [checkedProvider()]
    })]
  })
  const bundle = deployment.bundles.get("remote")
  if (bundle === undefined) throw new Error("remote pool emitted no bundle")
  const keyPair = generateDeploymentSigningKeyPair()
  const verificationKey = deploymentVerificationKey(keyPair)
  const artifactBytes = encodeSignedDeploymentArtifact(
    deployment.flow.plan,
    deployment.manifest,
    keyPair,
    { allowUnverifiedPlanProvenance: true }
  )
  const authentication = authenticateDeployment(deployment, artifactBytes, [verificationKey])
  const directory = mkdtempSync(join(tmpdir(), "smithers-lease-budget-"))
  const bundlePath = join(directory, "pool-bundle.mjs")
  const artifactPath = join(directory, "deployment.json")
  const keysPath = join(directory, "trusted-keys.json")
  writeFileSync(bundlePath, bundle.javascript, "utf8")
  writeFileSync(artifactPath, artifactBytes)
  writeFileSync(keysPath, JSON.stringify([verificationKey]), "utf8")
  const secret = generateWorkerTransportSecret()
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      fileURLToPath(new URL("./worker-host.ts", import.meta.url)),
      "--artifact", artifactPath,
      "--keys", keysPath,
      "--bundle", bundlePath,
      "--pool", "remote",
      "--port", "0"
    ],
    cwd: process.cwd(),
    env: { ...process.env, SMITHERS_WORKER_HOST_SECRET: secret },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe"
  })
  const events: WorkerHostEvent[] = []
  let remainder = ""
  const pump = (async (): Promise<void> => {
    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        remainder += decoder.decode(chunk.value, { stream: true })
        while (true) {
          const newline = remainder.indexOf("\n")
          if (newline < 0) break
          const line = remainder.slice(0, newline).trim()
          remainder = remainder.slice(newline + 1)
          if (line !== "") events.push(JSON.parse(line) as WorkerHostEvent)
        }
      }
    } finally {
      reader.releaseLock()
    }
  })()
  const store = new DurableStore()
  try {
    const stopAt = Date.now() + 20_000
    let listening: Extract<WorkerHostEvent, { readonly type: "listening" }> | undefined
    while (listening === undefined && Date.now() < stopAt) {
      listening = events.find(
        (event): event is Extract<WorkerHostEvent, { readonly type: "listening" }> =>
          event.type === "listening"
      )
      if (listening === undefined) await Bun.sleep(10)
    }
    if (listening === undefined) throw new Error("worker host never reported listening")
    const executor = createAuthenticatedDurableExecutor(authentication, store, {
      transports: [trustWorkerTransport(
        REMOTE_HTTP_SANDBOX,
        remoteHttpWorkerFactory({ baseUrl: `http://127.0.0.1:${listening.port}`, secret })
      )]
    })
    return await executor.execute({ value: 40, rounds: SPIN_ROUNDS }, runOptions("lease-budget-remote"))
  } finally {
    store.close()
    child.kill("SIGKILL")
    await child.exited
    await pump.catch(() => {})
    rmSync(directory, { recursive: true, force: true })
  }
})

test("an Action that outlives leaseMs reaches the same verdict on every worker transport", async () => {
  const outcomes = [
    await runLocal(),
    await runIsolated(),
    await runBundle(),
    await runRemote()
  ]

  // The premise: every transport really did run the attempt past its
  // claim-time lease snapshot. Without this the test proves nothing.
  for (const outcome of outcomes) {
    expect({ transport: outcome.transport, longerThanLease: outcome.durationMs > LEASE_MS })
      .toEqual({ transport: outcome.transport, longerThanLease: true })
  }

  const verdicts = new Set(outcomes.map((outcome) => outcome.outcome))
  expect({ verdicts: [...verdicts], detail: outcomes }).toEqual({
    verdicts: ['success:{"value":41}'],
    detail: outcomes
  })
}, 120_000)

/** The budget is enforced against `budget`, never against the stale lease snapshot. */
const hostInvocation = (budgetMs: number, deadlineMs: number): Invocation => ({
  schemaVersion: 1,
  executionId: "lease-budget-abort",
  nodeId: "n1",
  attempt: 1,
  actionId: ACTION_ID,
  actionVersion: 1,
  actionContractDigest: descriptor.contractDigest,
  implementationDigest: "0".repeat(64),
  input: { value: 40, rounds: 0 },
  deadline: Date.now() + deadlineMs,
  downstreamIdempotencyKey: "1".repeat(64),
  capabilityGrant: [],
  lease: { owner: "coordinator", expiresAt: Date.now() + 30_000 },
  budget: { expiresAt: Date.now() + budgetMs },
  fencingToken: 1,
  traceContext: {}
})

test("a worker-host budget timeout cancels the dispatch instead of leaving it running", async () => {
  const WORK_MS = 400
  const BUDGET_MS = 120

  const deployment = Deployment.build({
    id: "lease-budget-abort",
    flow: flowPlan(),
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [checkedProvider()] })]
  })
  const route = deployment.manifest.routes[0]
  if (route === undefined) throw new Error("fixture manifest has no route")

  let sawSignal = false
  let cancelled = false
  let ranToCompletion = false
  const module: LoadedBundleModule = {
    meta: { formatVersion: 1, poolId: "local", actionIds: [ACTION_ID] },
    invoke: async (_invocation, signal) => {
      sawSignal = signal !== undefined
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          ranToCompletion = true
          resolve()
        }, WORK_MS)
        signal?.addEventListener("abort", () => {
          cancelled = true
          clearTimeout(timer)
          resolve()
        }, { once: true })
      })
      return { kind: "success", value: { value: 41 } }
    }
  }

  // The lease snapshot is set to the same short horizon as the budget, so this
  // test isolates CANCELLATION: any budget derivation reaches the timeout here.
  const invocation: Invocation = {
    ...hostInvocation(BUDGET_MS, 60_000),
    lease: { owner: "coordinator", expiresAt: Date.now() + BUDGET_MS }
  }
  const exit = await runBundleInvocation(module, invocation, { value: 40, rounds: 0 }, route)
  expect(exit.kind === "defect" ? exit.defect.name : exit.kind).toBe("InvocationBudgetExceeded")

  // The host must hand the dispatch a cancellation channel and use it.
  expect({ sawSignal, cancelledAtTimeout: cancelled }).toEqual({ sawSignal: true, cancelledAtTimeout: true })

  // Wait past the point where the abandoned dispatch WOULD have finished. If the
  // timeout merely stopped waiting, this flips true and a second live copy of the
  // attempt is running while the coordinator retries it elsewhere.
  await Bun.sleep(WORK_MS)
  expect({ ranToCompletion }).toEqual({ ranToCompletion: false })
})

test("the host budget comes from the coordinator's budget, not the claim-time lease snapshot", async () => {
  const deployment = Deployment.build({
    id: "lease-budget-snapshot",
    flow: flowPlan(),
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [checkedProvider()] })]
  })
  const route = deployment.manifest.routes[0]
  if (route === undefined) throw new Error("fixture manifest has no route")

  // A lease snapshot that expired 30s ago (the coordinator has renewed it many
  // times since) with a live coordinator budget: the work must still run.
  const invocation: Invocation = {
    ...hostInvocation(5_000, 60_000),
    lease: { owner: "coordinator", expiresAt: Date.now() - 30_000 }
  }
  const module: LoadedBundleModule = {
    meta: { formatVersion: 1, poolId: "local", actionIds: [ACTION_ID] },
    invoke: async () => {
      await Bun.sleep(300)
      return { kind: "success", value: { value: 41 } }
    }
  }
  expect(await runBundleInvocation(module, invocation, { value: 40, rounds: 0 }, route))
    .toEqual({ kind: "success", value: { value: 41 } })
})
