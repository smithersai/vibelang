import type { AuthenticatedWorkerFactory } from "./authenticated-executor.ts"
import {
  canonicalJson,
  decodeCanonicalJson,
  deepFreeze,
  encodeCanonicalJson,
  type DeploymentManifest,
  type Invocation,
  type WorkerExit,
  type WorkerPoolManifest
} from "./ir.ts"
import {
  LocalWorker,
  withInvocationBudget,
  type ActionProvider,
  type DurableWorker,
  type WorkerPool
} from "./provider.ts"
import {
  assertWorkerTransportSecret,
  REMOTE_HTTP_SANDBOX,
  signWorkerHttpMessage,
  validateWorkerHostHandshake,
  verifyWorkerHttpMessage,
  WORKER_AUTH_HEADER,
  WORKER_HANDSHAKE_PATH,
  WORKER_INVOKE_PATH,
  type WorkerHostHandshake
} from "./worker-protocol.ts"

/**
 * Coordinator-side transport for the `remote-http-poc` sandbox: it speaks the
 * authenticated worker-host HTTP protocol on 127.0.0.1. Before ANY invocation
 * crosses the network, the full LocalWorker gate authenticates the invocation
 * envelope, and the first use performs a handshake in which the host must
 * advertise exactly the bundle digest, artifact digest, manifest digest, and
 * Plan digest the coordinator's signed deployment pins — a host serving any
 * other bundle is rejected before an invoke request exists.
 *
 * Registered through `trustWorkerTransport(REMOTE_HTTP_SANDBOX, ...)`, so the
 * authenticated coordinator's no-silent-downgrade property applies unchanged:
 * a signed `remote-http-poc` pool without this exact host-issued transport
 * token fails before any factory or network call.
 */

const HANDSHAKE_TIMEOUT_MS = 5_000
const INVOKE_GRACE_MS = 500
const MAX_RESPONSE_BYTES = 9 * 1024 * 1024

export interface RemoteHttpWorkerOptions {
  /** Worker host base URL; this POC accepts only http://127.0.0.1:<port>. */
  readonly baseUrl: string
  /** Shared HMAC secret (lowercase hex, 32-64 bytes). */
  readonly secret: string
}

const defect = (name: string, message: string): WorkerExit => ({
  kind: "defect",
  defect: { name, message }
})

const parseBaseUrl = (baseUrl: string): URL => {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new TypeError("RemoteHttpWorker baseUrl must be a valid URL")
  }
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" ||
    url.pathname !== "/" || url.search !== "" || url.hash !== "" ||
    url.username !== "" || url.password !== "") {
    throw new TypeError(
      "RemoteHttpWorker accepts only plain http://127.0.0.1:<port> base URLs; " +
      "this transport is a local-network POC without TLS"
    )
  }
  return url
}

export class RemoteHttpWorker implements DurableWorker {
  readonly poolManifest: WorkerPoolManifest
  readonly #gate: LocalWorker
  readonly #manifest: DeploymentManifest
  readonly #baseUrl: URL
  readonly #secret: string
  #handshake: Promise<WorkerHostHandshake> | undefined

  constructor(
    pool: WorkerPool,
    manifest: DeploymentManifest,
    providers: ReadonlyMap<string, ActionProvider<any, any, any>>,
    options: RemoteHttpWorkerOptions
  ) {
    if (pool.sandbox !== REMOTE_HTTP_SANDBOX) {
      throw new TypeError(`RemoteHttpWorker serves only the ${REMOTE_HTTP_SANDBOX} sandbox, not ${pool.sandbox}`)
    }
    this.#secret = assertWorkerTransportSecret(options.secret)
    this.#baseUrl = parseBaseUrl(options.baseUrl)
    const poolManifest = manifest.pools.find((candidate) => candidate.id === pool.id)
    if (poolManifest === undefined) throw new TypeError(`Pool ${pool.id} absent from deployment manifest`)
    if (poolManifest.bundleDigest === undefined) {
      throw new TypeError(
        `Pool ${pool.id} was not built with bundle emission; remote workers execute only digest-pinned bundles`
      )
    }
    this.poolManifest = poolManifest
    this.#manifest = manifest
    this.#gate = new LocalWorker(pool, manifest, providers)
    // `poolManifest` is the only thing standing between this client and a host
    // serving a different bundle: `#ensureHandshake` compares the host's
    // advertised digests against exactly these fields. As a public field it
    // could be reassigned after construction, which would make the handshake
    // authenticate whatever the attacker wanted it to. Private state
    // (`#handshake`) is unaffected by the freeze.
    Object.freeze(this)
  }

  async #post(path: string, body: unknown, signal: AbortSignal): Promise<Uint8Array> {
    const bodyBytes = encodeCanonicalJson(body)
    const response = await fetch(new URL(path, this.#baseUrl), {
      method: "POST",
      body: bodyBytes as unknown as BodyInit,
      signal,
      redirect: "error",
      headers: {
        "content-type": "application/json",
        [WORKER_AUTH_HEADER]: signWorkerHttpMessage(this.#secret, {
          role: "request",
          method: "POST",
          path,
          bodyBytes
        })
      }
    })
    const responseBuffer = await response.arrayBuffer()
    if (responseBuffer.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error(`worker host response for ${path} exceeds ${MAX_RESPONSE_BYTES} bytes`)
    }
    const responseBytes = new Uint8Array(responseBuffer)
    const authentic = verifyWorkerHttpMessage(this.#secret, response.headers.get(WORKER_AUTH_HEADER), {
      role: "response",
      method: "POST",
      path,
      bodyBytes: responseBytes
    })
    if (!authentic) throw new Error(`worker host response for ${path} failed HMAC authentication`)
    if (response.status !== 200) {
      throw new Error(`worker host rejected ${path} with authenticated status ${response.status}`)
    }
    return responseBytes
  }

  async #ensureHandshake(): Promise<WorkerHostHandshake> {
    const active = this.#handshake
    if (active !== undefined) return active
    const pending = (async (): Promise<WorkerHostHandshake> => {
        const responseBytes = await this.#post(
          WORKER_HANDSHAKE_PATH,
          {},
          AbortSignal.timeout(HANDSHAKE_TIMEOUT_MS)
        )
        const handshake = validateWorkerHostHandshake(decodeCanonicalJson(responseBytes, "worker host handshake"))
        const pool = this.poolManifest
        if (
          handshake.deploymentId !== this.#manifest.deploymentId ||
          handshake.poolId !== pool.id ||
          handshake.sandbox !== pool.sandbox ||
          handshake.target !== pool.target ||
          handshake.planDigest !== this.#manifest.planDigest ||
          handshake.manifestDigest !== this.#manifest.digest ||
          handshake.artifactDigest !== pool.artifactDigest ||
          handshake.bundleDigest !== pool.bundleDigest ||
          canonicalJson(handshake.actionIds) !== canonicalJson(pool.actionIds)
        ) {
          throw new Error(
            `worker host advertises a different deployment than the signed manifest pins ` +
            `(host bundle ${handshake.bundleDigest}, manifest bundle ${pool.bundleDigest})`
          )
        }
        return handshake
      })()
    this.#handshake = pending
    try {
      // Re-handshake for every invocation (coalescing only concurrent calls).
      // A process can disappear and another bind the same loopback port; a
      // successful handshake from a prior process must never authenticate its
      // replacement or bypass the replacement's advertised bundle digest.
      return await pending
    } finally {
      if (this.#handshake === pending) this.#handshake = undefined
    }
  }

  async invoke(
    rawInvocation: Invocation,
    signal: AbortSignal = new AbortController().signal
  ): Promise<WorkerExit> {
    const prepared = this.#gate.prepare(rawInvocation, signal)
    if (!prepared.ready) return prepared.exit
    const invocation: Invocation = deepFreeze({
      ...prepared.invocation,
      input: prepared.input
    })
    try {
      await this.#ensureHandshake()
    } catch (error) {
      return defect(
        "RemoteWorkerHandshakeDefect",
        error instanceof Error ? error.message : String(error)
      )
    }
    // The coordinator's budget, verbatim. This used to be
    // `min(deadline, lease.expiresAt)`, which cut every Action longer than
    // leaseMs off at the claim-time lease snapshot the coordinator had already
    // renewed - killing here what the in-process, isolated, and bundle
    // transports ran to completion. The grace lets the host's own budget verdict
    // arrive over the wire instead of being severed mid-response.
    return withInvocationBudget(
      invocation,
      {
        label: "remote",
        route: prepared.route,
        protocolDefectName: "RemoteProtocolDefect",
        signal,
        graceMs: INVOKE_GRACE_MS
      },
      async (budgetSignal) => {
        let responseBytes: Uint8Array
        try {
          responseBytes = await this.#post(WORKER_INVOKE_PATH, { invocation }, budgetSignal)
        } catch (error) {
          return defect(
            "RemoteTransportDefect",
            error instanceof Error ? `${error.name}: ${error.message}` : String(error)
          )
        }
        try {
          const decoded = decodeCanonicalJson(responseBytes, "worker host invoke response")
          if (decoded === null || typeof decoded !== "object" || Array.isArray(decoded) ||
            canonicalJson(Object.keys(decoded).sort()) !== canonicalJson(["exit", "source"]) ||
            ((decoded as { source: unknown }).source !== "live" &&
              (decoded as { source: unknown }).source !== "committed")) {
            throw new TypeError("worker host invoke response has invalid fields")
          }
          // A worker host is not a trusted producer of exits: nothing here can
          // verify what it actually ran, only what it claims. The budget seam
          // this returns into decodes the exit against the route's exact
          // discriminant and structural codecs before any caller sees it.
          return (decoded as { exit: unknown }).exit
        } catch (error) {
          return defect(
            "RemoteProtocolDefect",
            error instanceof Error ? error.message : String(error)
          )
        }
      }
    )
  }
}

/**
 * A worker-transport factory suitable for
 * `trustWorkerTransport(REMOTE_HTTP_SANDBOX, remoteHttpWorkerFactory(...))`.
 */
export const remoteHttpWorkerFactory = (options: RemoteHttpWorkerOptions): AuthenticatedWorkerFactory => {
  assertWorkerTransportSecret(options.secret)
  parseBaseUrl(options.baseUrl)
  return (pool, manifest, providers) => new RemoteHttpWorker(pool, manifest, providers, options)
}
