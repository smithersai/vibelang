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

/**
 * The signed message. A newline joins the six fields, and four of them cannot
 * hold one: `AUTH_DOMAIN` is a constant, `role` is a two-member union,
 * `timestampMs` is a safe integer rendered as digits, and the body is 64 hex.
 * `method` and `path` are the two the caller supplies verbatim, and they are
 * adjacent — so without the refusal below, `("GET\n/a", "/b")` and
 * `("GET", "/a\n/b")` produce the SAME bytes and therefore the same MAC. A
 * signature over one authorizes the other, which is the whole thing a MAC is
 * for.
 *
 * Refusing the separator is the fix rather than escaping or length-prefixing
 * it, for one reason: an escape changes the bytes and so changes every MAC,
 * which would make a signed request from a coordinator at one revision
 * unverifiable by a worker at another. Refusal restores injectivity on the
 * accepted domain and leaves every well-formed message byte-identical. Nothing
 * legitimate is lost — RFC 9110 forbids a newline in a method token and in a
 * request target, so a message this rejects could not have crossed an HTTP
 * connection in the first place.
 *
 * `method.toUpperCase()` is deliberately many-to-one and is safe for the same
 * reason: HTTP methods are case-insensitive, so `get` and `GET` NAME one
 * request and folding them is the point rather than a loss. It is
 * locale-independent (`toUpperCase`, never `toLocaleUpperCase`), so two hosts
 * in two locales fold identically.
 *
 * Throwing here rather than returning is what makes `verifyWorkerHttpMessage`
 * fail closed: its `catch` turns this into `false`, so a hostile method or path
 * is an unauthenticated message and not an exception.
 */
const macFor = (
  secret: string,
  role: "request" | "response",
  timestampMs: number,
  method: string,
  path: string,
  bodyBytes: Uint8Array
): string => {
  if (method.includes("\n") || path.includes("\n")) {
    fail("worker auth method and path cannot contain the field separator")
  }
  return createHmac("sha256", Buffer.from(secret, "hex"))
    .update([
      AUTH_DOMAIN,
      role,
      String(timestampMs),
      method.toUpperCase(),
      path,
      sha256Hex(bodyBytes)
    ].join("\n"), "utf8")
    .digest("hex")
}

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
