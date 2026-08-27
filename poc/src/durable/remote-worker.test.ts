import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  Action,
  authenticateDeployment,
  compileActionContract,
  compileActionImplementationContract,
  compileDurableSource,
  createAuthenticatedDurableExecutor,
  Deployment,
  deploymentVerificationKey,
  digest,
  DurableStore,
  encodeCanonicalJson,
  encodeSignedDeploymentArtifact,
  generateDeploymentSigningKeyPair,
  generateWorkerTransportSecret,
  PlanArtifact,
  Provider,
  REMOTE_HTTP_SANDBOX,
  RemoteHttpWorker,
  remoteHttpWorkerFactory,
  signWorkerHttpMessage,
  startWorkerHost,
  trustWorkerTransport,
  verifyWorkerHttpMessage,
  Worker,
  WORKER_AUTH_HEADER,
  WORKER_HANDSHAKE_PATH,
  WORKER_INVOKE_PATH,
  WORKER_HTTP_PROTOCOL,
  type Invocation,
  type JsonValue,
  type TrustedWorkerTransport,
  type WorkerHostEvent,
  type WorkerHostHandshake
} from "./index.ts"

let hostCallbackCalls = 0

const hostCallback = (): never => {
  hostCallbackCalls += 1
  throw new Error("remote bundle execution must never call the coordinator provider callback")
}

const REMOTE_ACTION_ID = "test/remote-http/Work"
const REMOTE_POOL_ID = "remote-http-worker"

const buildFixture = () => {
  const actionContract = compileActionContract(`
import { Action } from "smithers:flows"
class Failed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Work extends Action<
  (input: { value: number, spinMs: number }) => Result<{ value: number }, Failed>
> {}
`, {
    // Nominal durable Error identity includes the logical source file. The
    // Action declaration and implementation closure intentionally use the
    // same logical module name, as a checked real module would.
    fileName: "remote-work-implementation.sm",
    exportName: "Work",
    id: REMOTE_ACTION_ID,
    version: 1
  })
  if (!actionContract.ok) throw new Error(JSON.stringify(actionContract.diagnostics))
  const descriptor = actionContract.descriptor
  const implementationContract = compileActionImplementationContract({
    action: descriptor,
    implementationId: "remote-work-implementation",
    implementationVersion: "1",
    entryFile: "remote-work-implementation.sm",
    exportName: "work",
    implementation: hostCallback,
    sources: [{
      fileName: "remote-work-implementation.sm",
      source: `
class Failed extends Error {
  constructor(readonly code: string) { super(code) }
}
export function work(input: { value: number, spinMs: number }): Result<{ value: number }, Failed> {
  if (input.value < -1000) throw new Failed("too-low")
  let total = 0
  for (let index = 0; index < input.spinMs; index++) {
    total = (total + index) % 1000003
  }
  if (total < 0) throw new Failed("impossible")
  return { value: input.value + 1 }
}
`
    }]
  })
  const action = Action.fromDescriptor<
    { value: number; spinMs: number },
    { value: number },
    { code: string }
  >(descriptor)
  const provider = Provider.provideChecked(action, hostCallback, {
    implementationId: "remote-work-implementation",
    implementationVersion: "1",
    implementationContract,
    recovery: { mode: "repeatable", maxAttempts: 4, delayMs: 800 }
  })
  const compiled = compileDurableSource(`
import { durable } from "smithers:flows"
import { Work } from "test:remote-http-actions"
export const RemoteFlow = durable(function RemoteFlow(input: { value: number, spinMs: number }) {
  return Work.run({ value: input.value, spinMs: input.spinMs })
})
`, {
    fileName: "flows/remote-http.sm",
    flowId: "test/remote-http/Flow",
    flowVersion: 1,
    actions: [Object.freeze({
      moduleSpecifier: "test:remote-http-actions",
      exportName: "Work",
      descriptor
    })]
  })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  const deployment = Deployment.build({
    id: "remote-http-deployment",
    flow: PlanArtifact.load(PlanArtifact.encode(compiled.plan)),
    pools: [Worker.pool(REMOTE_POOL_ID, {
      target: "typescript-bun",
      sandbox: REMOTE_HTTP_SANDBOX,
      bundle: true,
      providers: [provider]
    })]
  })
  const keyPair = generateDeploymentSigningKeyPair()
  const verificationKey = deploymentVerificationKey(keyPair)
  const artifactBytes = encodeSignedDeploymentArtifact(
    deployment.flow.plan,
    deployment.manifest,
    keyPair,
    // This fixture's Plan is Flow.define-recorded; signing it is deliberate.
    { allowUnverifiedPlanProvenance: true }
  )
  const authentication = authenticateDeployment(deployment, artifactBytes, [verificationKey])
  const bundle = deployment.bundles.get(REMOTE_POOL_ID)
  if (bundle === undefined) throw new Error("remote fixture did not emit its pool bundle")
  const actionNode = deployment.flow.plan.nodes.find((node) => node.kind === "action")
  if (actionNode?.kind !== "action") throw new Error("remote fixture Plan has no Action node")
  const route = deployment.manifest.routes[0]
  if (route === undefined) throw new Error("remote fixture manifest has no route")
  return {
    deployment,
    authentication,
    artifactBytes,
    verificationKey,
    bundle,
    actionNode,
    route
  }
}

let cachedFixture: ReturnType<typeof buildFixture> | undefined
const fixture = (): ReturnType<typeof buildFixture> => cachedFixture ??= buildFixture()

const invocation = (
  source: ReturnType<typeof buildFixture>,
  options: {
    readonly executionId: string
    readonly attempt?: number
    readonly fencingToken?: number
    readonly owner?: string
    readonly leaseExpiresAt?: number
    readonly value?: number
    readonly spinMs?: number
  }
): Invocation => ({
  schemaVersion: 1,
  executionId: options.executionId,
  nodeId: source.actionNode.id,
  attempt: options.attempt ?? 1,
  actionId: source.route.actionId,
  actionVersion: source.route.actionVersion,
  actionContractDigest: source.route.actionContractDigest,
  implementationDigest: source.route.implementationDigest,
  input: { value: options.value ?? 4, spinMs: options.spinMs ?? 0 },
  deadline: Date.now() + 60_000,
  downstreamIdempotencyKey: digest({ executionId: options.executionId, nodeId: source.actionNode.id }),
  capabilityGrant: source.route.policy.capabilityGrant,
  lease: {
    owner: options.owner ?? "remote-test-owner",
    expiresAt: options.leaseExpiresAt ?? Date.now() + 30_000
  },
  fencingToken: options.fencingToken ?? 1,
  traceContext: {}
})

const authenticatedResponse = (
  secret: string,
  path: string,
  value: JsonValue,
  status = 200
): Response => {
  const bodyBytes = encodeCanonicalJson(value)
  return new Response(bodyBytes as unknown as BodyInit, {
    status,
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
}

const hostFiles = (source: ReturnType<typeof buildFixture>) => {
  const directory = mkdtempSync(join(tmpdir(), "smithers-remote-worker-"))
  const bundlePath = join(directory, "pool-bundle.mjs")
  const artifactPath = join(directory, "deployment.json")
  const keysPath = join(directory, "trusted-keys.json")
  writeFileSync(bundlePath, source.bundle.javascript, "utf8")
  writeFileSync(artifactPath, source.artifactBytes)
  writeFileSync(keysPath, JSON.stringify([source.verificationKey]), "utf8")
  return {
    directory,
    bundlePath,
    artifactPath,
    keysPath,
    cleanup: (): void => rmSync(directory, { recursive: true, force: true })
  }
}

const spawnWorkerHost = async (
  files: ReturnType<typeof hostFiles>,
  secret: string,
  port = 0
) => {
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      fileURLToPath(new URL("./worker-host.ts", import.meta.url)),
      "--artifact", files.artifactPath,
      "--keys", files.keysPath,
      "--bundle", files.bundlePath,
      "--pool", REMOTE_POOL_ID,
      "--port", String(port)
    ],
    cwd: process.cwd(),
    env: { ...process.env, SMITHERS_WORKER_HOST_SECRET: secret },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe"
  })
  const events: WorkerHostEvent[] = []
  let stdoutRemainder = ""
  let pumpError: unknown
  const stderr = new Response(child.stderr).text()
  const pump = (async (): Promise<void> => {
    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        stdoutRemainder += decoder.decode(chunk.value, { stream: true })
        while (true) {
          const newline = stdoutRemainder.indexOf("\n")
          if (newline < 0) break
          const line = stdoutRemainder.slice(0, newline).trim()
          stdoutRemainder = stdoutRemainder.slice(newline + 1)
          if (line !== "") events.push(JSON.parse(line) as WorkerHostEvent)
        }
      }
      stdoutRemainder += decoder.decode()
      const trailing = stdoutRemainder.trim()
      if (trailing !== "") events.push(JSON.parse(trailing) as WorkerHostEvent)
    } catch (error) {
      pumpError = error
    } finally {
      reader.releaseLock()
    }
  })()
  const waitFor = async <Event extends WorkerHostEvent>(
    predicate: (event: WorkerHostEvent) => event is Event,
    timeoutMs = 10_000
  ): Promise<Event> => {
    const stopAt = Date.now() + timeoutMs
    while (Date.now() < stopAt) {
      const found = events.find(predicate)
      if (found !== undefined) return found
      if (pumpError !== undefined) throw pumpError
      await Bun.sleep(10)
    }
    throw new Error(`worker-host event timed out; events=${JSON.stringify(events)}`)
  }
  const listening = await waitFor(
    (event): event is Extract<WorkerHostEvent, { readonly type: "listening" }> => event.type === "listening"
  )
  return {
    child,
    port: listening.port,
    url: `http://127.0.0.1:${listening.port}`,
    events,
    waitFor,
    stderr,
    stop: async (signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): Promise<void> => {
      child.kill(signal)
      await child.exited
      await pump
    }
  }
}

test("missing, forged, and mismatched remote transport tokens fail before any network call", () => {
  const source = fixture()
  let networkCalls = 0
  let factoryCalls = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => {
      networkCalls += 1
      return new Response(null, { status: 500 })
    }
  })
  const baseUrl = `http://127.0.0.1:${server.port}`
  const secret = generateWorkerTransportSecret()
  const factory = remoteHttpWorkerFactory({ baseUrl, secret })
  const wrong = trustWorkerTransport("remote-http-poc-misspelled", (...args) => {
    factoryCalls += 1
    return factory(...args)
  })

  const missingStore = new DurableStore()
  expect(() => createAuthenticatedDurableExecutor(source.authentication, missingStore))
    .toThrow(`signed sandbox ${REMOTE_HTTP_SANDBOX} has no exact trusted worker transport`)
  missingStore.close()

  const forgedStore = new DurableStore()
  expect(() => createAuthenticatedDurableExecutor(source.authentication, forgedStore, {
    transports: [{ sandbox: REMOTE_HTTP_SANDBOX } as unknown as TrustedWorkerTransport]
  })).toThrow("was not issued by this host")
  forgedStore.close()

  const mismatchStore = new DurableStore()
  expect(() => createAuthenticatedDurableExecutor(source.authentication, mismatchStore, {
    transports: [wrong]
  })).toThrow(`signed sandbox ${REMOTE_HTTP_SANDBOX} has no exact trusted worker transport`)
  mismatchStore.close()

  expect(factoryCalls).toBe(0)
  expect(networkCalls).toBe(0)
  server.stop(true)
})

test("a worker advertising a different bundle digest is rejected at handshake before invoke", async () => {
  const source = fixture()
  const secret = generateWorkerTransportSecret()
  const paths: string[] = []
  const pool = source.deployment.manifest.pools[0]!
  const mismatchedHandshake: WorkerHostHandshake = {
    protocol: WORKER_HTTP_PROTOCOL,
    deploymentId: source.deployment.manifest.deploymentId,
    poolId: pool.id,
    sandbox: pool.sandbox,
    target: pool.target,
    planDigest: source.deployment.manifest.planDigest,
    manifestDigest: source.deployment.manifest.digest,
    artifactDigest: pool.artifactDigest,
    bundleDigest: "0".repeat(64),
    actionIds: pool.actionIds
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      const bodyBytes = new Uint8Array(await request.arrayBuffer())
      paths.push(url.pathname)
      expect(verifyWorkerHttpMessage(secret, request.headers.get(WORKER_AUTH_HEADER), {
        role: "request",
        method: request.method,
        path: url.pathname,
        bodyBytes
      })).toBe(true)
      if (url.pathname !== WORKER_HANDSHAKE_PATH) return new Response(null, { status: 500 })
      return authenticatedResponse(secret, url.pathname, mismatchedHandshake as unknown as JsonValue)
    }
  })
  try {
    const worker = new RemoteHttpWorker(
      source.deployment.pools.get(REMOTE_POOL_ID)!,
      source.deployment.manifest,
      source.deployment.providers,
      { baseUrl: `http://127.0.0.1:${server.port}`, secret }
    )
    const exit = await worker.invoke(invocation(source, { executionId: "remote-wrong-handshake" }))
    expect(exit.kind).toBe("defect")
    if (exit.kind !== "defect") throw new Error("expected handshake defect")
    expect(exit.defect.name).toBe("RemoteWorkerHandshakeDefect")
    expect(exit.defect.message).toContain("advertises a different deployment")
    expect(paths).toEqual([WORKER_HANDSHAKE_PATH])
  } finally {
    server.stop(true)
  }
})

test("the real host authenticates requests, dispatches the bundle, and enforces fencing order", async () => {
  const source = fixture()
  const secret = generateWorkerTransportSecret()
  const files = hostFiles(source)
  const events: WorkerHostEvent[] = []
  const host = await startWorkerHost({
    artifactBytes: source.artifactBytes,
    trustedKeys: [source.verificationKey],
    bundlePath: files.bundlePath,
    poolId: REMOTE_POOL_ID,
    secret,
    onEvent: (event) => events.push(event)
  })
  try {
    const unauthorized = await fetch(`${host.url}${WORKER_HANDSHAKE_PATH}`, {
      method: "POST",
      body: encodeCanonicalJson({}) as unknown as BodyInit
    })
    expect(unauthorized.status).toBe(401)
    expect(events.some((event) => event.type === "unauthorized")).toBe(true)

    const worker = new RemoteHttpWorker(
      source.deployment.pools.get(REMOTE_POOL_ID)!,
      source.deployment.manifest,
      source.deployment.providers,
      { baseUrl: host.url, secret }
    )
    const acceptedInvocation = invocation(source, {
      executionId: "remote-host-fence",
      attempt: 2,
      fencingToken: 2,
      value: 9
    })
    const accepted = await worker.invoke(acceptedInvocation)
    expect(accepted).toEqual({ kind: "success", value: { value: 10 } })

    const stale = await worker.invoke(invocation(source, {
      executionId: "remote-host-fence",
      attempt: 1,
      fencingToken: 1,
      value: 9
    }))
    expect(stale.kind).toBe("defect")
    if (stale.kind !== "defect") throw new Error("expected stale-fence defect")
    expect(stale.defect.name).toBe("StaleFencingToken")

    const conflict = await worker.invoke(invocation(source, {
      executionId: "remote-host-fence",
      attempt: 2,
      fencingToken: 2,
      value: 10
    }))
    expect(conflict.kind).toBe("defect")
    if (conflict.kind !== "defect") throw new Error("expected fencing conflict defect")
    expect(conflict.defect.name).toBe("FencingIdentityConflict")

    const replay = await worker.invoke(acceptedInvocation)
    expect(replay).toEqual(accepted)
    expect(events.filter((event) =>
      event.type === "invoke" && event.executionId === "remote-host-fence").length).toBe(1)
    expect(events.some((event) => event.type === "exit" && event.source === "committed")).toBe(true)
    expect(hostCallbackCalls).toBe(0)
  } finally {
    await host.stop()
    files.cleanup()
  }
})

test("a stale remote exit is rejected by the same store fence as a local exit", async () => {
  const source = fixture()
  const secret = generateWorkerTransportSecret()
  const files = hostFiles(source)
  const host = await startWorkerHost({
    artifactBytes: source.artifactBytes,
    trustedKeys: [source.verificationKey],
    bundlePath: files.bundlePath,
    poolId: REMOTE_POOL_ID,
    secret
  })
  const store = new DurableStore()
  try {
    store.initializeExecution(
      "remote-stale-store",
      source.deployment.flow.plan,
      source.deployment.manifest,
      { value: 5, spinMs: 0 },
      Date.now() + 60_000
    )
    const first = store.claimNode(
      "remote-stale-store",
      source.actionNode.id,
      "remote-owner-1",
      20_000
    )
    if (first.kind !== "claimed") throw new Error("first remote claim was not acquired")
    const worker = new RemoteHttpWorker(
      source.deployment.pools.get(REMOTE_POOL_ID)!,
      source.deployment.manifest,
      source.deployment.providers,
      { baseUrl: host.url, secret }
    )
    const remoteExit = await worker.invoke(invocation(source, {
      executionId: "remote-stale-store",
      attempt: first.attempt,
      fencingToken: first.fencingToken,
      owner: "remote-owner-1",
      leaseExpiresAt: first.leaseExpiresAt,
      value: 5
    }))
    expect(remoteExit).toEqual({ kind: "success", value: { value: 6 } })
    if (remoteExit.kind !== "success") throw new Error("expected a remote success")

    const second = store.claimNode(
      "remote-stale-store",
      source.actionNode.id,
      "remote-owner-2",
      20_000,
      first.leaseExpiresAt + 1
    )
    if (second.kind !== "claimed") throw new Error("replacement remote claim was not acquired")
    expect(second.fencingToken).toBeGreaterThan(first.fencingToken)
    expect(store.commitSuccess(
      "remote-stale-store",
      source.actionNode.id,
      "remote-owner-1",
      first.fencingToken,
      remoteExit.value
    )).toBe(false)
    expect(store.commitSuccess(
      "remote-stale-store",
      source.actionNode.id,
      "remote-owner-2",
      second.fencingToken,
      remoteExit.value
    )).toBe(true)
    expect(store.getNode("remote-stale-store", source.actionNode.id).exit).toEqual({
      kind: "success",
      value: { value: 6 },
      adoptedFrom: null
    })
  } finally {
    store.close()
    await host.stop()
    files.cleanup()
  }
})

test("real worker-host death recovers by lease/retry and coordinator restart adopts the commit", async () => {
  const source = fixture()
  hostCallbackCalls = 0
  const secret = generateWorkerTransportSecret()
  const files = hostFiles(source)
  const databasePath = join(files.directory, "durable.sqlite")
  let firstHost: Awaited<ReturnType<typeof spawnWorkerHost>> | undefined
  let replacementHost: Awaited<ReturnType<typeof spawnWorkerHost>> | undefined
  let store: DurableStore | undefined
  let restartedStore: DurableStore | undefined
  try {
    firstHost = await spawnWorkerHost(files, secret)
    store = new DurableStore(databasePath)
    const transport = trustWorkerTransport(
      REMOTE_HTTP_SANDBOX,
      remoteHttpWorkerFactory({ baseUrl: firstHost.url, secret })
    )
    const executor = createAuthenticatedDurableExecutor(source.authentication, store, {
      transports: [transport]
    })
    const running = executor.execute(
      { value: 40, spinMs: 300_000_000 },
      {
        executionId: "remote-subprocess-recovery",
        deadline: Date.now() + 30_000,
        leaseMs: 4_000
      }
    )
    await firstHost.waitFor(
      (event): event is Extract<WorkerHostEvent, { readonly type: "invoke" }> => event.type === "invoke"
    )
    await firstHost.stop("SIGKILL")
    replacementHost = await spawnWorkerHost(files, secret, firstHost.port)

    expect(await running).toEqual({ value: 41 })
    const journal = store.journal("remote-subprocess-recovery")
    expect(journal.some((event) => event.type === "attempt_retry_scheduled")).toBe(true)
    expect(journal.filter((event) =>
      event.type === "attempt_started" || event.type === "attempt_lease_stolen").length).toBeGreaterThanOrEqual(2)
    const succeeded = journal.find((event) => event.type === "node_succeeded")
    expect(succeeded).toBeDefined()
    expect((succeeded!.payload as { readonly fencingToken: number }).fencingToken).toBeGreaterThan(1)
    expect(hostCallbackCalls).toBe(0)

    store.close()
    store = undefined
    await replacementHost.stop()
    replacementHost = undefined

    // The host is now absent. A fresh store connection and coordinator still
    // expose the run-local committed result without a handshake or reinvoke.
    restartedStore = new DurableStore(databasePath)
    const deadTransport = trustWorkerTransport(
      REMOTE_HTTP_SANDBOX,
      remoteHttpWorkerFactory({ baseUrl: firstHost.url, secret })
    )
    const restarted = createAuthenticatedDurableExecutor(source.authentication, restartedStore, {
      transports: [deadTransport]
    })
    expect(await restarted.resume("remote-subprocess-recovery").result()).toEqual({ value: 41 })
    expect(restartedStore.getExecution("remote-subprocess-recovery").status).toBe("completed")
  } finally {
    if (store !== undefined) store.close()
    if (restartedStore !== undefined) restartedStore.close()
    if (replacementHost !== undefined) await replacementHost.stop("SIGKILL")
    if (firstHost !== undefined && firstHost.child.exitCode === null) await firstHost.stop("SIGKILL")
    files.cleanup()
  }
}, 30_000)
