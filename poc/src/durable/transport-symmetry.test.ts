import { expect, test } from "bun:test"
import { DenoSubprocessSandbox } from "../agent/sandbox.ts"
import {
  Action,
  compileActionContract,
  compileActionImplementationContract,
  compileDurableSource,
  createDenoIsolatedWorkerArtifact,
  DenoBundleWorker,
  DenoIsolatedWorker,
  Deployment,
  DurableExecutionCancelled,
  DurableExecutor,
  DurableStore,
  encodeCanonicalJson,
  LocalWorker,
  PlanArtifact,
  Provider,
  REMOTE_HTTP_SANDBOX,
  RemoteHttpWorker,
  generateWorkerTransportSecret,
  signWorkerHttpMessage,
  WORKER_AUTH_HEADER,
  WORKER_HANDSHAKE_PATH,
  WORKER_HTTP_PROTOCOL,
  WORKER_INVOKE_PATH,
  Worker,
  type ActionDescriptor,
  type ActionRouteManifest,
  type BuiltDeployment,
  type DurableWorker,
  type Invocation,
  type JsonValue,
  type WorkerExit
} from "./index.ts"
import { runBundleInvocation, type LoadedBundleModule } from "./worker-host.ts"

/**
 * A `WorkerExit` that crossed a process or a network boundary is untrusted
 * input, and every transport that admits one must decode it before anyone can
 * act on it. These tests feed a MALFORMED or out-of-contract exit through each
 * of the five worker transports and pin that none of them hands its caller
 * anything but a well-formed exit.
 *
 * They also pin the two other capabilities that existed on one transport and
 * not its siblings: the worker host's client cancellation channel, and the
 * per-invocation re-verification of the pinned code identity a worker executes.
 */

const ACTION_ID = "test/transport-symmetry/Work"
const SOURCE_FILE = "transport-symmetry.sm"

const sandbox = (): DenoSubprocessSandbox => new DenoSubprocessSandbox({
  timeoutMs: 20_000,
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
  (input: { value: number }) => Result<{ value: number }, Failed>
> {}
`, { fileName: SOURCE_FILE, exportName: "Work", id: ACTION_ID, version: 1 })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  return compiled.descriptor
}

const descriptor = compileAction()
const WorkAction = Action.fromDescriptor<{ value: number }, { value: number }, { code: string }>(descriptor)

const hostImplementation = (input: { value: number }): { value: number } => ({ value: input.value + 1 })

/**
 * A checked implementation whose EMITTED source returns an object the Action's
 * success schema does not admit. Nothing in the bundle pipeline validates the
 * value the entry point returns (`pool-bundle.ts` wraps it verbatim as
 * `{ kind: "success", value: output }`), so this is the ordinary way a bundle
 * produces an out-of-contract exit — no hostile process required.
 */
const outOfContractContract = compileActionImplementationContract({
  action: descriptor,
  implementationId: "transport-symmetry-out-of-contract",
  implementationVersion: "1",
  entryFile: SOURCE_FILE,
  exportName: "work",
  implementation: hostImplementation,
  sources: [{
    fileName: SOURCE_FILE,
    source: `
class Failed extends Error {
  constructor(readonly code: string) { super(code) }
}
export function work(input: { value: number }): Result<{ value: number }, Failed> {
  const output = { value: input.value + 1, exfiltrated: 1 }
  return output
}
`
  }]
})

const outOfContractProvider = () => Provider.provideChecked(WorkAction, hostImplementation, {
  implementationId: "transport-symmetry-out-of-contract",
  implementationVersion: "1",
  implementationContract: outOfContractContract,
  recovery: { mode: "manual", maxAttempts: 1 }
})

const flowPlan = () => {
  const compiled = compileDurableSource(`
import { durable } from "smithers:flows"
import { Work } from "test:transport-symmetry-actions"
export const SymmetryFlow = durable(function SymmetryFlow(input: { value: number }) {
  return Work.run({ value: input.value })
})
`, {
    fileName: "flows/transport-symmetry.sm",
    flowId: "test/transport-symmetry/Flow",
    flowVersion: 1,
    actions: [Object.freeze({
      moduleSpecifier: "test:transport-symmetry-actions",
      exportName: "Work",
      descriptor
    })]
  })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  return PlanArtifact.load(PlanArtifact.encode(compiled.plan))
}

const routeOf = (deployment: BuiltDeployment<any, any>): ActionRouteManifest => {
  const route = deployment.manifest.routes.find((candidate) => candidate.actionId === ACTION_ID)
  if (route === undefined) throw new Error("fixture manifest has no route")
  return route
}

const invocationFor = (
  route: ActionRouteManifest,
  overrides: Partial<Invocation> = {}
): Invocation => ({
  schemaVersion: 1,
  executionId: "transport-symmetry",
  nodeId: "n1",
  attempt: 1,
  actionId: ACTION_ID,
  actionVersion: 1,
  actionContractDigest: descriptor.contractDigest,
  implementationDigest: route.implementationDigest,
  input: { value: 40 },
  deadline: Date.now() + 60_000,
  downstreamIdempotencyKey: "1".repeat(64),
  capabilityGrant: route.policy.capabilityGrant,
  lease: { owner: "coordinator", expiresAt: Date.now() + 30_000 },
  budget: { expiresAt: Date.now() + 30_000 },
  fencingToken: 1,
  traceContext: {},
  ...overrides
})

/** A transport may only ever hand back one of the three exact `WorkerExit` shapes. */
const wellFormedExit = (exit: WorkerExit): boolean => {
  if (exit === null || typeof exit !== "object" || Array.isArray(exit)) return false
  const keys = Object.keys(exit).sort().join(",")
  if (exit.kind === "success") return keys === "kind,value"
  if (exit.kind === "failure") return keys === "error,kind"
  if (exit.kind === "defect") {
    if (keys !== "defect,kind") return false
    const defectKeys = Object.keys(exit.defect).sort().join(",")
    return defectKeys === "message,name" || defectKeys === "message,name,stack"
  }
  return false
}

const describeExit = (exit: WorkerExit): string =>
  exit.kind === "defect" ? `defect:${exit.defect.name}` : `${exit.kind}:${JSON.stringify(exit)}`

// ---------------------------------------------------------------------------
// 1. the exit codec, at every transport boundary
// ---------------------------------------------------------------------------

const localExit = async (): Promise<WorkerExit> => {
  // The in-process implementation returns a value its Action contract forbids.
  const provider = Provider.provide(
    WorkAction,
    (() => ({ value: 41, exfiltrated: 1 })) as never,
    {
      implementationId: "transport-symmetry-local",
      implementationVersion: "1",
      recovery: { mode: "manual", maxAttempts: 1 }
    }
  )
  const deployment = Deployment.build({
    id: "transport-symmetry-local",
    flow: flowPlan(),
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [provider] })]
  })
  const pool = deployment.pools.get("local")!
  const worker: DurableWorker = new LocalWorker(pool, deployment.manifest, deployment.providers)
  return worker.invoke(invocationFor(routeOf(deployment)))
}

const isolatedExit = async (functionExpression: string): Promise<WorkerExit> => {
  const isolated = sandbox()
  const artifact = createDenoIsolatedWorkerArtifact({
    poolId: "isolated",
    sandbox: isolated,
    functionExpression
  })
  const provider = Provider.provide(WorkAction, hostImplementation, {
    implementationId: "transport-symmetry-isolated",
    implementationVersion: "1",
    dependencyDigests: [artifact.digest],
    recovery: { mode: "manual", maxAttempts: 1 }
  })
  const deployment = Deployment.build({
    id: "transport-symmetry-isolated",
    flow: flowPlan(),
    pools: [Worker.pool("isolated", {
      target: "typescript-deno",
      sandbox: isolated.kind,
      providers: [provider]
    })]
  })
  const pool = deployment.pools.get("isolated")!
  const worker = new DenoIsolatedWorker(pool, deployment.manifest, deployment.providers, {
    artifact,
    sandbox: isolated
  })
  return worker.invoke(invocationFor(routeOf(deployment)))
}

const bundleExit = async (): Promise<WorkerExit> => {
  const isolated = sandbox()
  const deployment = Deployment.build({
    id: "transport-symmetry-bundle",
    flow: flowPlan(),
    pools: [Worker.pool("deno-bundle", {
      target: "typescript-deno",
      sandbox: isolated.kind,
      bundle: true,
      providers: [outOfContractProvider()]
    })]
  })
  const bundle = deployment.bundles.get("deno-bundle")
  if (bundle === undefined) throw new Error("bundle pool emitted no bundle")
  const pool = deployment.pools.get("deno-bundle")!
  const worker = new DenoBundleWorker(pool, deployment.manifest, deployment.providers, {
    bundle,
    sandbox: isolated
  })
  return worker.invoke(invocationFor(routeOf(deployment)))
}

/**
 * A worker host that speaks the exact authenticated protocol and answers with
 * whatever bytes the test chooses. This is the severity case: the coordinator
 * cannot verify the bundle a host actually ran, only what the host claims, so
 * the exit arriving over the wire is untrusted input by construction.
 */
const remoteExit = async (responseBody: (invocation: Invocation) => Uint8Array): Promise<WorkerExit> => {
  const deployment = Deployment.build({
    id: "transport-symmetry-remote",
    flow: flowPlan(),
    pools: [Worker.pool("remote", {
      target: "typescript-bun",
      sandbox: REMOTE_HTTP_SANDBOX,
      bundle: true,
      providers: [outOfContractProvider()]
    })]
  })
  const manifest = deployment.manifest
  const poolManifest = manifest.pools.find((candidate) => candidate.id === "remote")!
  const secret = generateWorkerTransportSecret()
  const handshake = {
    actionIds: poolManifest.actionIds,
    artifactDigest: poolManifest.artifactDigest,
    bundleDigest: poolManifest.bundleDigest!,
    deploymentId: manifest.deploymentId,
    manifestDigest: manifest.digest,
    planDigest: manifest.planDigest,
    poolId: poolManifest.id,
    protocol: WORKER_HTTP_PROTOCOL,
    sandbox: poolManifest.sandbox,
    target: poolManifest.target
  }
  const respond = (path: string, bodyBytes: Uint8Array): Response =>
    new Response(bodyBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/json",
        [WORKER_AUTH_HEADER]: signWorkerHttpMessage(secret, {
          role: "response",
          method: "POST",
          path,
          bodyBytes
        })
      }
    })
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname
      if (path === WORKER_HANDSHAKE_PATH) {
        return respond(path, encodeCanonicalJson(handshake as unknown as JsonValue))
      }
      if (path === WORKER_INVOKE_PATH) {
        const body = JSON.parse(new TextDecoder().decode(new Uint8Array(await request.arrayBuffer()))) as {
          invocation: Invocation
        }
        return respond(path, responseBody(body.invocation))
      }
      return new Response(null, { status: 404 })
    }
  })
  try {
    const pool = deployment.pools.get("remote")!
    const worker = new RemoteHttpWorker(pool, manifest, deployment.providers, {
      baseUrl: `http://127.0.0.1:${server.port}`,
      secret
    })
    return await worker.invoke(invocationFor(routeOf(deployment)))
  } finally {
    await server.stop(true)
  }
}

const workerHostExit = async (raw: unknown): Promise<WorkerExit> => {
  const deployment = Deployment.build({
    id: "transport-symmetry-host",
    flow: flowPlan(),
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [outOfContractProvider()] })]
  })
  const route = routeOf(deployment)
  const module: LoadedBundleModule = {
    meta: { formatVersion: 1, poolId: "local", actionIds: [ACTION_ID] },
    invoke: async () => raw
  }
  return runBundleInvocation(module, invocationFor(route), { value: 40 }, route)
}

test("no worker transport hands its caller an exit it has not decoded", async () => {
  const observed: { transport: string; exit: string; wellFormed: boolean }[] = []
  const record = (transport: string, exit: WorkerExit): void => {
    observed.push({ transport, exit: describeExit(exit), wellFormed: wellFormedExit(exit) })
  }

  record("local", await localExit())
  record("isolated/out-of-contract", await isolatedExit(
    `() => ({ kind: "success", value: { value: 41, exfiltrated: 1 } })`
  ))
  record("isolated/unknown-kind", await isolatedExit(
    `() => ({ kind: "not-an-exit", value: { value: 41 } })`
  ))
  record("isolated/extra-fields", await isolatedExit(
    `() => ({ kind: "success", value: { value: 41 }, exfiltrated: "secrets" })`
  ))
  record("bundle", await bundleExit())
  record("remote/out-of-contract", await remoteExit(() => encodeCanonicalJson({
    exit: { kind: "success", value: { value: 41, exfiltrated: 1 } },
    source: "live"
  } as unknown as JsonValue)))
  record("remote/unknown-kind", await remoteExit(() => encodeCanonicalJson({
    exit: { kind: "not-an-exit" },
    source: "live"
  } as unknown as JsonValue)))
  record("remote/defect-extra-fields", await remoteExit(() => encodeCanonicalJson({
    exit: { kind: "defect", defect: { message: "m", name: "n", privilege: "root" } },
    source: "live"
  } as unknown as JsonValue)))
  record("worker-host/unknown-kind", await workerHostExit({ kind: "not-an-exit" }))
  record("worker-host/out-of-contract", await workerHostExit({
    kind: "success",
    value: { value: 41, exfiltrated: 1 }
  }))

  // Every one of these inputs is inadmissible: not one of them may come back as
  // a raw exit shape, and not one may come back as anything but a defect a
  // caller can act on safely.
  expect(observed.filter((entry) => !entry.wellFormed || !entry.exit.startsWith("defect:")))
    .toEqual([])
}, 180_000)

test("a hostile exit cannot reach the coordinator's committed state", async () => {
  const isolated = sandbox()
  const artifact = createDenoIsolatedWorkerArtifact({
    poolId: "isolated",
    sandbox: isolated,
    functionExpression: `() => ({ kind: "success", value: { value: 41, exfiltrated: "secrets" } })`
  })
  const provider = Provider.provide(WorkAction, hostImplementation, {
    implementationId: "transport-symmetry-coordinator",
    implementationVersion: "1",
    dependencyDigests: [artifact.digest],
    recovery: { mode: "manual", maxAttempts: 1 }
  })
  const deployment = Deployment.build({
    id: "transport-symmetry-coordinator",
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
    const settled = await executor
      .execute({ value: 40 }, { executionId: "hostile-exit" })
      .then((value) => ({ ok: true, value }))
      .catch((error: unknown) => ({
        ok: false,
        value: (error as { defect?: { name?: string } }).defect?.name ?? String(error)
      }))
    expect(settled).toEqual({ ok: false, value: "SuccessCodecDefect" })
  } finally {
    store.close()
  }
}, 120_000)

// ---------------------------------------------------------------------------
// 2. the worker host's client cancellation channel
// ---------------------------------------------------------------------------

test("the worker host refuses to start a dispatch its client has already abandoned", async () => {
  const deployment = Deployment.build({
    id: "transport-symmetry-host-signal",
    flow: flowPlan(),
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [outOfContractProvider()] })]
  })
  const route = routeOf(deployment)
  let dispatched = false
  const module: LoadedBundleModule = {
    meta: { formatVersion: 1, poolId: "local", actionIds: [ACTION_ID] },
    invoke: async () => {
      dispatched = true
      return { kind: "success", value: { value: 41 } }
    }
  }
  const controller = new AbortController()
  controller.abort()
  const exit = await runBundleInvocation(
    module,
    invocationFor(route),
    { value: 40 },
    route,
    controller.signal
  )
  expect({ dispatched, exit: describeExit(exit) })
    .toEqual({ dispatched: false, exit: "defect:InvocationCancelled" })
})

test("the worker host cancels an in-flight dispatch when its client disconnects", async () => {
  const deployment = Deployment.build({
    id: "transport-symmetry-host-disconnect",
    flow: flowPlan(),
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [outOfContractProvider()] })]
  })
  const route = routeOf(deployment)
  let cancelled = false
  let ranToCompletion = false
  const module: LoadedBundleModule = {
    meta: { formatVersion: 1, poolId: "local", actionIds: [ACTION_ID] },
    invoke: async (_invocation, signal) => {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          ranToCompletion = true
          resolve()
        }, 400)
        signal?.addEventListener("abort", () => {
          cancelled = true
          clearTimeout(timer)
          resolve()
        }, { once: true })
      })
      // Exactly what the emitted bundle driver does with the signal it is given.
      if (signal?.aborted) {
        return { kind: "defect", defect: { name: "InvocationCancelled", message: "client went away" } }
      }
      return { kind: "success", value: { value: 41 } }
    }
  }
  const controller = new AbortController()
  const pending = runBundleInvocation(
    module,
    invocationFor(route),
    { value: 40 },
    route,
    controller.signal
  )
  await Bun.sleep(50)
  controller.abort()
  const exit = await pending
  await Bun.sleep(450)
  expect({ cancelled, ranToCompletion, exit: describeExit(exit) })
    .toEqual({ cancelled: true, ranToCompletion: false, exit: "defect:InvocationCancelled" })
})

// ---------------------------------------------------------------------------
// 3. per-invocation re-verification of the pinned code identity
// ---------------------------------------------------------------------------

test("the isolated worker cannot be made to execute an artifact it was not admitted with", async () => {
  const isolated = sandbox()
  const artifact = createDenoIsolatedWorkerArtifact({
    poolId: "isolated",
    sandbox: isolated,
    functionExpression: `() => ({ kind: "success", value: { value: 41 } })`
  })
  const forged = createDenoIsolatedWorkerArtifact({
    poolId: "isolated",
    sandbox: isolated,
    functionExpression: `() => ({ kind: "success", value: { value: 666 } })`
  })
  const provider = Provider.provide(WorkAction, hostImplementation, {
    implementationId: "transport-symmetry-pinned",
    implementationVersion: "1",
    dependencyDigests: [artifact.digest],
    recovery: { mode: "manual", maxAttempts: 1 }
  })
  const deployment = Deployment.build({
    id: "transport-symmetry-pinned",
    flow: flowPlan(),
    pools: [Worker.pool("isolated", {
      target: "typescript-deno",
      sandbox: isolated.kind,
      providers: [provider]
    })]
  })
  const pool = deployment.pools.get("isolated")!
  const worker = new DenoIsolatedWorker(pool, deployment.manifest, deployment.providers, {
    artifact,
    sandbox: isolated
  })
  // The deployment signature covers `artifact.digest`; nothing outside this
  // process may choose which bytes the worker actually runs.
  let swapRejected = false
  try {
    ;(worker as unknown as { artifact: unknown }).artifact = forged
  } catch {
    swapRejected = true
  }
  const exit = await worker.invoke(invocationFor(routeOf(deployment)))
  const executed = exit.kind === "success" ? (exit.value as { value: number }).value : describeExit(exit)
  expect({ swapRejected: swapRejected || executed !== 666, executed })
    .toEqual({ swapRejected: true, executed: 41 })
}, 120_000)

test("no worker transport's trust anchors can be reassigned after admission", async () => {
  const isolated = sandbox()
  const artifact = createDenoIsolatedWorkerArtifact({
    poolId: "isolated",
    sandbox: isolated,
    functionExpression: `() => ({ kind: "success", value: { value: 41 } })`
  })
  const isolatedProvider = Provider.provide(WorkAction, hostImplementation, {
    implementationId: "transport-symmetry-frozen",
    implementationVersion: "1",
    dependencyDigests: [artifact.digest],
    recovery: { mode: "manual", maxAttempts: 1 }
  })
  const plan = flowPlan()
  const localDeployment = Deployment.build({
    id: "transport-symmetry-frozen-local",
    flow: plan,
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [outOfContractProvider()] })]
  })
  const isolatedDeployment = Deployment.build({
    id: "transport-symmetry-frozen-isolated",
    flow: plan,
    pools: [Worker.pool("isolated", {
      target: "typescript-deno",
      sandbox: isolated.kind,
      providers: [isolatedProvider]
    })]
  })
  const bundleDeployment = Deployment.build({
    id: "transport-symmetry-frozen-bundle",
    flow: plan,
    pools: [Worker.pool("deno-bundle", {
      target: "typescript-deno",
      sandbox: isolated.kind,
      bundle: true,
      providers: [outOfContractProvider()]
    })]
  })
  const remoteDeployment = Deployment.build({
    id: "transport-symmetry-frozen-remote",
    flow: plan,
    pools: [Worker.pool("remote", {
      target: "typescript-bun",
      sandbox: REMOTE_HTTP_SANDBOX,
      bundle: true,
      providers: [outOfContractProvider()]
    })]
  })
  const workers: { transport: string; worker: object }[] = [
    {
      transport: "local",
      worker: new LocalWorker(
        localDeployment.pools.get("local")!,
        localDeployment.manifest,
        localDeployment.providers
      )
    },
    {
      transport: "isolated",
      worker: new DenoIsolatedWorker(
        isolatedDeployment.pools.get("isolated")!,
        isolatedDeployment.manifest,
        isolatedDeployment.providers,
        { artifact, sandbox: isolated }
      )
    },
    {
      transport: "bundle",
      worker: new DenoBundleWorker(
        bundleDeployment.pools.get("deno-bundle")!,
        bundleDeployment.manifest,
        bundleDeployment.providers,
        { bundle: bundleDeployment.bundles.get("deno-bundle")!, sandbox: isolated }
      )
    },
    {
      transport: "remote",
      worker: new RemoteHttpWorker(
        remoteDeployment.pools.get("remote")!,
        remoteDeployment.manifest,
        remoteDeployment.providers,
        { baseUrl: "http://127.0.0.1:9", secret: generateWorkerTransportSecret() }
      )
    }
  ]
  // Every field these workers authenticate against — provider table, manifest,
  // pinned artifact, pinned bundle, pool manifest — is public, so a mutable
  // instance means the checks the constructor performed can be undone afterwards.
  expect(workers.filter((entry) => !Object.isFrozen(entry.worker)).map((entry) => entry.transport))
    .toEqual([])
})

// ---------------------------------------------------------------------------
// 4. cancellation preempts retry backoff
// ---------------------------------------------------------------------------

test("cancelling an execution preempts an Action's retry backoff", async () => {
  const BACKOFF_MS = 4_000
  let attempts = 0
  let firstAttemptFailed: (() => void) | undefined
  const observedFirstFailure = new Promise<void>((resolve) => { firstAttemptFailed = resolve })
  const provider = Provider.provide(WorkAction, () => {
    attempts += 1
    queueMicrotask(() => firstAttemptFailed?.())
    throw new Error("always fails")
  }, {
    implementationId: "transport-symmetry-retry",
    implementationVersion: "1",
    recovery: { mode: "repeatable", maxAttempts: 5, delayMs: BACKOFF_MS }
  })
  const deployment = Deployment.build({
    id: "transport-symmetry-retry",
    flow: flowPlan(),
    pools: [Worker.pool("local", { target: "typescript-bun", providers: [provider] })]
  })
  const store = new DurableStore()
  try {
    const executor = new DurableExecutor(deployment, store)
    const running = executor
      .execute({ value: 40 }, { executionId: "retry-cancel", deadline: Date.now() + 60_000 })
      .then(() => "completed")
      .catch((error: unknown) =>
        error instanceof DurableExecutionCancelled ? "cancelled" : `threw:${String(error)}`)
    await observedFirstFailure
    await Bun.sleep(50)
    const cancelledAt = Date.now()
    executor.cancel("retry-cancel", { name: "Cancelled", message: "operator" })
    const outcome = await running
    const elapsedMs = Date.now() - cancelledAt
    expect({ outcome, attempts, preempted: elapsedMs < BACKOFF_MS / 2, elapsedMs })
      .toEqual({ outcome: "cancelled", attempts: 1, preempted: true, elapsedMs })
  } finally {
    store.close()
  }
}, 60_000)
