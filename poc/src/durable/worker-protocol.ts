import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import {
  assertJson,
  canonicalJson,
  deepFreeze
} from "./ir.ts"

/**
 * Shared wire protocol for the POC remote worker transport: one worker-host
 * process serves a digest-pinned pool bundle over HTTP on 127.0.0.1, and the
 * coordinator's RemoteHttpWorker speaks to it. Every request AND response is
 * authenticated with an HMAC-SHA256 over a domain-separated canonical string
 * under one per-deployment shared secret.
 *
 * HONEST TRUST BOUNDARY: this is a local-trust seam, not production network
 * authentication. There is no TLS, no key rotation or revocation, no
 * per-principal identity, and replay of an identical signed request inside the
 * freshness window is possible (handlers are idempotent by invocation
 * identity). Any principal holding the shared secret is fully trusted; secret
 * custody and distribution are deliberately unsolved here.
 */

export const REMOTE_HTTP_SANDBOX = "remote-http-poc"
export const WORKER_HTTP_PROTOCOL = 1 as const
export const WORKER_AUTH_HEADER = "x-smithers-worker-auth"
export const WORKER_HANDSHAKE_PATH = "/smithers/worker/v1/handshake"
export const WORKER_INVOKE_PATH = "/smithers/worker/v1/invoke"
/** Requests and responses older or newer than this are rejected. */
export const WORKER_AUTH_MAX_SKEW_MS = 120_000

const AUTH_DOMAIN = "smithers.worker-http.v1"
const AUTH_PREFIX = "v1"
const SECRET_PATTERN = /^[0-9a-f]{64,128}$/
const HEX_DIGEST = /^[0-9a-f]{64}$/
const MAC_PATTERN = /^[0-9a-f]{64}$/
const TIMESTAMP_PATTERN = /^[1-9][0-9]{0,14}$/

export class WorkerProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WorkerProtocolError"
  }
}

const fail = (message: string): never => {
  throw new WorkerProtocolError(message)
}

/** 32 random bytes as lowercase hex; mint one per deployment. */
export const generateWorkerTransportSecret = (): string => randomBytes(32).toString("hex")

export const assertWorkerTransportSecret = (secret: string): string => {
  if (typeof secret !== "string" || !SECRET_PATTERN.test(secret)) {
    return fail("worker transport secret must be 32-64 bytes of lowercase hex")
  }
  return secret
}

const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

const macFor = (
  secret: string,
  role: "request" | "response",
  timestampMs: number,
  method: string,
  path: string,
  bodyBytes: Uint8Array
): string =>
  createHmac("sha256", Buffer.from(secret, "hex"))
    .update([
      AUTH_DOMAIN,
      role,
      String(timestampMs),
      method.toUpperCase(),
      path,
      sha256Hex(bodyBytes)
    ].join("\n"), "utf8")
    .digest("hex")

export interface WorkerHttpAuthInput {
  readonly role: "request" | "response"
  readonly method: string
  readonly path: string
  readonly bodyBytes: Uint8Array
  readonly timestampMs?: number
}

/** Header value: `v1.<timestampMs>.<hmac-sha256 hex>`. */
export const signWorkerHttpMessage = (secret: string, input: WorkerHttpAuthInput): string => {
  assertWorkerTransportSecret(secret)
  const timestampMs = input.timestampMs ?? Date.now()
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 1) return fail("worker auth timestamp must be a positive integer")
  const mac = macFor(secret, input.role, timestampMs, input.method, input.path, input.bodyBytes)
  return `${AUTH_PREFIX}.${timestampMs}.${mac}`
}

/**
 * Timing-safe verification. Returns false for any parse, freshness, or MAC
 * failure; it never throws on hostile input and never reveals which check
 * failed.
 */
export const verifyWorkerHttpMessage = (
  secret: string,
  header: string | null | undefined,
  input: WorkerHttpAuthInput & { readonly nowMs?: number }
): boolean => {
  try {
    assertWorkerTransportSecret(secret)
    if (typeof header !== "string") return false
    const parts = header.split(".")
    if (parts.length !== 3 || parts[0] !== AUTH_PREFIX) return false
    const [, timestampText, mac] = parts as [string, string, string]
    if (!TIMESTAMP_PATTERN.test(timestampText) || !MAC_PATTERN.test(mac)) return false
    const timestampMs = Number(timestampText)
    if (!Number.isSafeInteger(timestampMs)) return false
    const nowMs = input.nowMs ?? Date.now()
    if (Math.abs(nowMs - timestampMs) > WORKER_AUTH_MAX_SKEW_MS) return false
    const expected = macFor(secret, input.role, timestampMs, input.method, input.path, input.bodyBytes)
    const expectedBytes = Buffer.from(expected, "hex")
    const providedBytes = Buffer.from(mac, "hex")
    if (expectedBytes.length !== providedBytes.length) return false
    return timingSafeEqual(expectedBytes, providedBytes)
  } catch {
    return false
  }
}

/**
 * What a worker host advertises before the coordinator will route any
 * invocation to it. The coordinator compares every digest against its own
 * signed manifest; a host advertising a different bundle is rejected before
 * any invoke request is sent.
 */
export interface WorkerHostHandshake {
  readonly protocol: typeof WORKER_HTTP_PROTOCOL
  readonly deploymentId: string
  readonly poolId: string
  readonly sandbox: string
  readonly target: string
  readonly planDigest: string
  readonly manifestDigest: string
  readonly artifactDigest: string
  readonly bundleDigest: string
  readonly actionIds: readonly string[]
}

export const validateWorkerHostHandshake = (value: unknown): WorkerHostHandshake => {
  let snapshot: unknown
  try {
    snapshot = assertJson(value, "worker host handshake")
  } catch (error) {
    return fail(error instanceof Error ? error.message : "worker host handshake is not canonical data")
  }
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot) ||
    canonicalJson(Object.keys(snapshot).sort()) !== canonicalJson([
      "actionIds", "artifactDigest", "bundleDigest", "deploymentId", "manifestDigest",
      "planDigest", "poolId", "protocol", "sandbox", "target"
    ])) {
    return fail("worker host handshake has missing or unknown fields")
  }
  const candidate = snapshot as WorkerHostHandshake
  if (candidate.protocol !== WORKER_HTTP_PROTOCOL) return fail("worker host handshake has an unsupported protocol")
  for (const [field, value_] of [
    ["deploymentId", candidate.deploymentId],
    ["poolId", candidate.poolId],
    ["sandbox", candidate.sandbox],
    ["target", candidate.target]
  ] as const) {
    if (typeof value_ !== "string" || value_.trim() === "") return fail(`worker host handshake ${field} must be non-empty`)
  }
  for (const [field, value_] of [
    ["planDigest", candidate.planDigest],
    ["manifestDigest", candidate.manifestDigest],
    ["artifactDigest", candidate.artifactDigest],
    ["bundleDigest", candidate.bundleDigest]
  ] as const) {
    if (typeof value_ !== "string" || !HEX_DIGEST.test(value_)) {
      return fail(`worker host handshake ${field} must be a lowercase SHA-256 digest`)
    }
  }
  if (!Array.isArray(candidate.actionIds) ||
    candidate.actionIds.some((id) => typeof id !== "string" || id.trim() === "") ||
    canonicalJson(candidate.actionIds) !== canonicalJson([...new Set(candidate.actionIds)].sort())) {
    return fail("worker host handshake actionIds must be sorted and unique")
  }
  return deepFreeze(snapshot as WorkerHostHandshake)
}

export const WorkerProtocol = Object.freeze({
  sandbox: REMOTE_HTTP_SANDBOX,
  protocol: WORKER_HTTP_PROTOCOL,
  authHeader: WORKER_AUTH_HEADER,
  handshakePath: WORKER_HANDSHAKE_PATH,
  invokePath: WORKER_INVOKE_PATH,
  generateSecret: generateWorkerTransportSecret,
  sign: signWorkerHttpMessage,
  verify: verifyWorkerHttpMessage,
  validateHandshake: validateWorkerHostHandshake
})
