import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  canonicalJson,
  decodeCanonicalJson,
  deepFreeze,
  digest,
  encodeCanonicalJson,
  type ActionRouteManifest,
  type DeploymentManifest,
  type Invocation,
  type JsonValue,
  type WorkerExit,
  type WorkerPoolManifest
} from "./ir.ts"
import {
  manifestWorkerGate,
  prepareManifestInvocation,
  withInvocationBudget,
  type ManifestWorkerGate
} from "./provider.ts"
import {
  decodeSignedDeploymentArtifact,
  type TrustedDeploymentKey
} from "./signed-deployment.ts"
import {
  signWorkerHttpMessage,
  validateWorkerHostHandshake,
  verifyWorkerHttpMessage,
  WORKER_AUTH_HEADER,
  WORKER_HANDSHAKE_PATH,
  WORKER_HTTP_PROTOCOL,
  WORKER_INVOKE_PATH,
  assertWorkerTransportSecret,
  type WorkerHostHandshake
} from "./worker-protocol.ts"
import { decodeWorkerExit, validateDurableValue, type WorkerExitSurface } from "./schema.ts"

/**
 * The POC remote worker host: one process, one signed deployment, one pool,
 * one digest-pinned bundle, served over authenticated HTTP on 127.0.0.1.
 *
 * The host independently authenticates the Ed25519 deployment artifact against
 * its own trust roots, refuses any bundle whose bytes do not hash to the signed
 * manifest's pool `bundleDigest`, validates every invocation envelope through
 * the exact manifest worker gate the in-process LocalWorker uses, and commits
 * exactly one exit per invocation identity while the host process lives: a
 * repeated identical request joins the in-flight execution or is answered
 * from the committed exit, never re-executed. A higher fencing token for the
 * same run-local node supersedes a lower one; a lower token or a different
 * envelope reusing the same token is rejected before Action dispatch.
 *
 * HONEST LIMITATIONS: the bounded committed-exit table is in-memory (a host
 * restart forgets it — durable exactly-once remains the coordinator store's
 * job via fencing tokens); the bundle executes with this process's ambient authority
 * (OS confinement is the DenoBundleWorker's proof, not this transport's); the
 * shared-secret HMAC is a local-trust seam without TLS, rotation, or custody.
 */

const MAX_REQUEST_BYTES = 9 * 1024 * 1024
const MAX_COMMITTED_EXITS = 10_000
const HOST_EXECUTION_GRACE_MS = 250

export type WorkerHostEvent =
  | { readonly type: "listening"; readonly port: number; readonly bundleDigest: string }
  | {
    readonly type: "invoke"
    readonly actionId: string
    readonly executionId: string
    readonly nodeId: string
    readonly attempt: number
    readonly fencingToken: number
  }
  | { readonly type: "exit"; readonly actionId: string; readonly kind: string; readonly source: "live" | "committed" }
  | { readonly type: "handshake" }
  | { readonly type: "unauthorized"; readonly path: string }

export interface StartWorkerHostOptions {
  /** Complete signed deployment artifact bytes (Ed25519 envelope). */
  readonly artifactBytes: Uint8Array | string
  /** Out-of-band trust roots used to authenticate the artifact. */
  readonly trustedKeys: readonly TrustedDeploymentKey[]
  /** Path to the emitted bundle file; its bytes must hash to the signed pool bundleDigest. */
  readonly bundlePath: string
  readonly poolId: string
  /** Shared HMAC secret (lowercase hex, 32-64 bytes). */
  readonly secret: string
  /** 0 (default) chooses an ephemeral port. */
  readonly port?: number
  readonly onEvent?: (event: WorkerHostEvent) => void
}

export interface StartedWorkerHost {
  readonly port: number
  readonly url: string
  readonly bundleDigest: string
  readonly poolId: string
  readonly stop: () => Promise<void>
}

export interface LoadedBundleModule {
  /**
   * The bundle's dispatch entry point. The signal is the host's execution
   * budget: the driver refuses to start, and discards a late result, once it
   * aborts, so budget expiry cancels the work instead of abandoning a second
   * live copy of it while the coordinator retries.
   */
  readonly invoke: (invocation: unknown, signal?: AbortSignal) => Promise<unknown>
  readonly meta: {
    readonly formatVersion: number
    readonly poolId: string
    readonly actionIds: readonly string[]
  }
}

const defect = (name: string, message: string): WorkerExit => ({
  kind: "defect",
  defect: { name, message }
})

/** Names this host's bundle transport to the shared exit decoder. */
const BUNDLE_EXIT_SURFACE: WorkerExitSurface = {
  label: "bundle",
  protocolDefectName: "BundleProtocolDefect"
}

const validateBundleExit = (route: ActionRouteManifest, value: unknown): WorkerExit =>
  decodeWorkerExit(route, value, BUNDLE_EXIT_SURFACE)

const loadBundleModule = async (
  bundlePath: string,
  pool: WorkerPoolManifest
): Promise<{ readonly module: LoadedBundleModule; readonly bundleDigest: string }> => {
  const absolute = resolve(bundlePath)
  const bundleBytes = readFileSync(absolute)
  const bundleDigest = createHash("sha256").update(bundleBytes).digest("hex")
  if (pool.bundleDigest === undefined) {
    throw new Error(`pool ${pool.id} was not built with bundle emission; the signed manifest pins no bundleDigest`)
  }
  if (bundleDigest !== pool.bundleDigest) {
    throw new Error(
      `worker host refuses bundle ${absolute}: bytes hash to ${bundleDigest} but the signed manifest ` +
      `pins ${pool.bundleDigest} for pool ${pool.id}`
    )
  }
  // The signed digest names exact UTF-8 JavaScript bytes, not a lossy host
  // decoding. Invalid UTF-8 fails before the module loader sees the file.
  new TextDecoder("utf-8", { fatal: true }).decode(bundleBytes)
  const loaded = await import(pathToFileURL(absolute).href) as {
    __smithersInvokeAction?: unknown
    __smithersPoolBundle?: unknown
  }
  const meta = loaded.__smithersPoolBundle as LoadedBundleModule["meta"] | undefined
  if (typeof loaded.__smithersInvokeAction !== "function" || meta === null || typeof meta !== "object" ||
    meta.formatVersion !== 1 || meta.poolId !== pool.id ||
    canonicalJson(meta.actionIds) !== canonicalJson(pool.actionIds)) {
    throw new Error(`bundle ${absolute} does not carry the expected pool ${pool.id} module interface`)
  }
  return {
    module: {
      invoke: loaded.__smithersInvokeAction as LoadedBundleModule["invoke"],
      meta
    },
    bundleDigest
  }
}

/**
 * Dispatch one invocation into the pool bundle under the coordinator's
 * execution budget.
 *
 * Two properties this must keep, and previously did not:
 *
 * 1. The budget is `Invocation.budget`, the coordinator's single derivation -
 *    not `min(deadline, lease.expiresAt)`. That claim-time lease snapshot is
 *    stale after one heartbeat, so it used to cut Actions longer than `leaseMs`
 *    off here while the in-process, isolated, and bundle transports ran the very
 *    same Action to completion.
 * 2. When the budget elapses the work is CANCELLED, not merely abandoned. This
 *    used to `Promise.race` a timer against `module.invoke` with no signal at
 *    all: the host answered `WorkerHostTimeout`, the coordinator retried, and
 *    the abandoned dispatch kept running in this process alongside the retry -
 *    a duplicate-execution window that existed on this transport and no other.
 *
 * Exported so the budget-and-cancellation behaviour is testable against a
 * substituted module without standing up a signed deployment and a socket.
 *
 * HONEST LIMITATION: cancellation here is cooperative and single-threaded. The
 * bundle driver refuses to start and discards a late result once the signal
 * aborts, which closes the commit-a-second-result window, but a bundle body
 * that is one synchronous compute loop still runs to its end - preempting that
 * is the OS-isolation property `DenoBundleWorker` has and this transport does not.
 */
export const runBundleInvocation = (
  module: LoadedBundleModule,
  invocation: Invocation,
  input: JsonValue,
  route: ActionRouteManifest
): Promise<WorkerExit> => withInvocationBudget(
  invocation,
  { label: "worker host", graceMs: HOST_EXECUTION_GRACE_MS },
  async (signal) => {
    try {
      const raw = await module.invoke({ ...invocation, input }, signal)
      return validateBundleExit(route, raw)
    } catch (error) {
      return defect(
        "BundleDispatchDefect",
        error instanceof Error ? error.message : String(error)
      )
    }
  }
)

export const startWorkerHost = async (options: StartWorkerHostOptions): Promise<StartedWorkerHost> => {
  const secret = assertWorkerTransportSecret(options.secret)
  if (typeof options.poolId !== "string" || options.poolId.trim() === "") {
    throw new TypeError("worker host pool id must be non-empty")
  }
  const artifact = decodeSignedDeploymentArtifact(options.artifactBytes, options.trustedKeys)
  const manifest: DeploymentManifest = artifact.manifest
  const pool = manifest.pools.find((candidate) => candidate.id === options.poolId)
  if (pool === undefined) {
    throw new Error(`pool ${options.poolId} is absent from the signed deployment manifest`)
  }
  const { module, bundleDigest } = await loadBundleModule(options.bundlePath, pool)
  const gate: ManifestWorkerGate = manifestWorkerGate(manifest, pool.id)
  const emit = options.onEvent ?? (() => {})

  const handshake: WorkerHostHandshake = validateWorkerHostHandshake({
    protocol: WORKER_HTTP_PROTOCOL,
    deploymentId: manifest.deploymentId,
    poolId: pool.id,
    sandbox: pool.sandbox,
    target: pool.target,
    planDigest: manifest.planDigest,
    manifestDigest: manifest.digest,
    artifactDigest: pool.artifactDigest,
    bundleDigest,
    actionIds: pool.actionIds
  })

  /** One committed exit per invocation identity; bounded and in-memory. */
  const committedExits = new Map<string, WorkerExit>()
  const inflight = new Map<string, Promise<WorkerExit>>()
  const fenceBindings = new Map<string, {
    readonly fencingToken: number
    readonly invocationDigest: string
  }>()

  const commitExit = (key: string, exit: WorkerExit): WorkerExit => {
    const existing = committedExits.get(key)
    if (existing !== undefined) return existing
    committedExits.set(key, exit)
    return exit
  }

  const respond = (path: string, status: number, body: JsonValue): Response => {
    const bodyBytes = encodeCanonicalJson(body)
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

  const runInvocation = (
    invocation: Invocation,
    input: JsonValue,
    route: ActionRouteManifest
  ): Promise<WorkerExit> => runBundleInvocation(module, invocation, input, route)

  const handleInvoke = async (bodyBytes: Uint8Array): Promise<JsonValue> => {
    let invocationValue: unknown
    try {
      const decoded = decodeCanonicalJson(bodyBytes, "worker invoke request")
      if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded) ||
        canonicalJson(Object.keys(decoded).sort()) !== canonicalJson(["invocation"])) {
        throw new TypeError("worker invoke request must carry exactly an invocation")
      }
      invocationValue = (decoded as { invocation: unknown }).invocation
    } catch (error) {
      return {
        source: "live",
        exit: defect("InvocationCodecDefect", error instanceof Error ? error.message : String(error))
      } as unknown as JsonValue
    }
    const prepared = prepareManifestInvocation(gate, invocationValue as Invocation)
    if (!prepared.ready) return { source: "live", exit: prepared.exit } as unknown as JsonValue
    const invocation = prepared.invocation
    const invocationDigest = digest(invocation)
    const identityKey = digest({
      executionId: invocation.executionId,
      nodeId: invocation.nodeId,
      attempt: invocation.attempt,
      fencingToken: invocation.fencingToken
    })
    const nodeKey = digest({
      executionId: invocation.executionId,
      nodeId: invocation.nodeId
    })
    const boundFence = fenceBindings.get(nodeKey)
    if (boundFence !== undefined && boundFence.fencingToken === invocation.fencingToken &&
      boundFence.invocationDigest !== invocationDigest) {
      const exit = defect(
        "FencingIdentityConflict",
        `${invocation.actionId} reused fencing token ${invocation.fencingToken} with a different invocation envelope`
      )
      return { source: "live", exit } as unknown as JsonValue
    }
    const committed = committedExits.get(identityKey)
    if (committed !== undefined) {
      emit({ type: "exit", actionId: invocation.actionId, kind: committed.kind, source: "committed" })
      return { source: "committed", exit: committed } as unknown as JsonValue
    }
    if (boundFence !== undefined && boundFence.fencingToken > invocation.fencingToken) {
      const exit = commitExit(identityKey, defect(
        "StaleFencingToken",
        `${invocation.actionId} fencing token ${invocation.fencingToken} is older than ` +
        `the host's accepted token ${boundFence.fencingToken}`
      ))
      return { source: "live", exit } as unknown as JsonValue
    }
    const active = inflight.get(identityKey)
    if (active !== undefined) {
      const exit = await active
      emit({ type: "exit", actionId: invocation.actionId, kind: exit.kind, source: "committed" })
      return { source: "committed", exit } as unknown as JsonValue
    }
    if (committedExits.size + inflight.size >= MAX_COMMITTED_EXITS) {
      return {
        source: "live",
        exit: defect(
          "WorkerHostCapacityExceeded",
          `worker host has reached its ${MAX_COMMITTED_EXITS} in-memory invocation limit; restart explicitly`
        )
      } as unknown as JsonValue
    }
    if (boundFence === undefined || boundFence.fencingToken < invocation.fencingToken) {
      fenceBindings.set(nodeKey, { fencingToken: invocation.fencingToken, invocationDigest })
    }
    emit({
      type: "invoke",
      actionId: invocation.actionId,
      executionId: invocation.executionId,
      nodeId: invocation.nodeId,
      attempt: invocation.attempt,
      fencingToken: invocation.fencingToken
    })
    const execution = (async (): Promise<WorkerExit> => {
      const candidate = await runInvocation(invocation, prepared.input, prepared.route)
      const latest = fenceBindings.get(nodeKey)
      const exit = latest !== undefined && latest.fencingToken > invocation.fencingToken
        ? defect(
          "StaleFencingToken",
          `${invocation.actionId} fencing token ${invocation.fencingToken} was superseded by ${latest.fencingToken}`
        )
        : candidate
      return commitExit(identityKey, exit)
    })()
    inflight.set(identityKey, execution)
    try {
      const exit = await execution
      emit({ type: "exit", actionId: invocation.actionId, kind: exit.kind, source: "live" })
      return { source: "live", exit } as unknown as JsonValue
    } finally {
      if (inflight.get(identityKey) === execution) inflight.delete(identityKey)
    }
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      const path = url.pathname
      if (request.method !== "POST") return new Response(null, { status: 405 })
      if (path !== WORKER_HANDSHAKE_PATH && path !== WORKER_INVOKE_PATH) {
        return new Response(null, { status: 404 })
      }
      const bodyBuffer = await request.arrayBuffer()
      if (bodyBuffer.byteLength > MAX_REQUEST_BYTES) return new Response(null, { status: 413 })
      const bodyBytes = new Uint8Array(bodyBuffer)
      const authorized = verifyWorkerHttpMessage(secret, request.headers.get(WORKER_AUTH_HEADER), {
        role: "request",
        method: "POST",
        path,
        bodyBytes
      })
      if (!authorized) {
        emit({ type: "unauthorized", path })
        return new Response(null, { status: 401 })
      }
      if (path === WORKER_HANDSHAKE_PATH) {
        emit({ type: "handshake" })
        return respond(path, 200, handshake as unknown as JsonValue)
      }
      return respond(path, 200, await handleInvoke(bodyBytes))
    }
  })

  const started: StartedWorkerHost = deepFreeze({
    port: server.port ?? 0,
    url: `http://127.0.0.1:${server.port}`,
    bundleDigest,
    poolId: pool.id,
    stop: async () => {
      await server.stop(true)
    }
  })
  emit({ type: "listening", port: started.port, bundleDigest })
  return started
}

interface CliArguments {
  readonly artifact: string
  readonly keys: string
  readonly bundle: string
  readonly pool: string
  readonly port: number
}

const parseCliArguments = (argv: readonly string[]): CliArguments => {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === undefined || !flag.startsWith("--") || value === undefined) {
      throw new Error(`invalid worker host argument: ${flag ?? "<missing>"}`)
    }
    values.set(flag.slice(2), value)
  }
  for (const required of ["artifact", "keys", "bundle", "pool"]) {
    if (!values.has(required)) throw new Error(`worker host requires --${required}`)
  }
  const port = values.has("port") ? Number(values.get("port")) : 0
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error("worker host --port must be 0-65535")
  }
  return {
    artifact: values.get("artifact")!,
    keys: values.get("keys")!,
    bundle: values.get("bundle")!,
    pool: values.get("pool")!,
    port
  }
}

if (import.meta.main) {
  const secret = process.env["SMITHERS_WORKER_HOST_SECRET"]
  if (secret === undefined) {
    console.error("worker host requires the SMITHERS_WORKER_HOST_SECRET environment variable")
    process.exit(2)
  }
  const cli = parseCliArguments(process.argv.slice(2))
  const trustedKeys = JSON.parse(readFileSync(resolve(cli.keys), "utf8")) as TrustedDeploymentKey[]
  const emitLine = (event: WorkerHostEvent): void => {
    console.log(JSON.stringify(event))
  }
  startWorkerHost({
    artifactBytes: readFileSync(resolve(cli.artifact)),
    trustedKeys,
    bundlePath: cli.bundle,
    poolId: cli.pool,
    secret,
    port: cli.port,
    onEvent: emitLine
  }).then((host) => {
    const shutdown = (): void => {
      void host.stop().then(() => process.exit(0))
    }
    process.on("SIGTERM", shutdown)
    process.on("SIGINT", shutdown)
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
