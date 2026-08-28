/**
 * The value-expression side of the durable IR: canonical JSON, digests,
 * `deepFreeze`, the target-neutral type descriptors and schemas, the
 * serializable provider policies, and the deployment/worker wire shapes.
 *
 * Split out of `ir.ts` unchanged. This half is independent of the Plan node
 * graph in `plan-ir.ts`; the dependency runs one way, from `plan-ir.ts` to
 * here, so nothing in this file has to move if the Plan graph is retired.
 * `ir.ts` re-exports both halves, so no import path moved with the split.
 */
import { createHash } from "node:crypto"
/** JSON is the deliberately narrow persistence boundary used by this POC. */
export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue }

export type DurableScalar = null | boolean | number | string

export interface DurableObjectField {
  readonly name: string
  readonly optional: boolean
  readonly value: DurableTypeDescriptor
}

/**
 * Canonical, target-neutral type evidence emitted before TypeScript erases the
 * Action signature. Object fields and union variants are stored in canonical
 * order so the descriptor itself is suitable for contract identity.
 */
export type DurableTypeDescriptor =
  | { readonly kind: "null" | "boolean" | "number" | "string" }
  | { readonly kind: "literal"; readonly value: DurableScalar }
  | { readonly kind: "array"; readonly element: DurableTypeDescriptor }
  | { readonly kind: "tuple"; readonly items: readonly DurableTypeDescriptor[] }
  | { readonly kind: "object"; readonly fields: readonly DurableObjectField[] }
  | { readonly kind: "union"; readonly variants: readonly DurableTypeDescriptor[] }
  | {
    readonly kind: "error"
    readonly identity: string
    readonly name: string
    readonly payload: Extract<DurableTypeDescriptor, { readonly kind: "object" }>
  }

export interface LegacyDurableSchema {
  readonly format: "canonical-json"
  readonly schemaVersion: 1
  readonly role: "input" | "success" | "error"
  readonly shape: "json-value"
  /** The real compiler will replace this marker with a derived schema. */
  readonly source: "compiler-derived-poc-stub"
  readonly digest: string
}

export interface StructuralDurableSchema {
  readonly format: "canonical-json"
  readonly schemaVersion: 1
  readonly role: "input" | "success" | "error"
  readonly shape: "structural"
  readonly source: "compiler-derived"
  readonly descriptor: DurableTypeDescriptor
  readonly digest: string
}

/** Legacy JSON schemas remain readable so existing Plan artifacts are stable. */
export type DurableSchema = LegacyDurableSchema | StructuralDurableSchema

export interface ActionDescriptor {
  readonly id: string
  readonly version: number
  /** Digest of identity, version, and the complete compiler-emitted schemas. */
  readonly contractDigest: string
  readonly inputSchema: DurableSchema
  readonly successSchema: DurableSchema
  readonly errorSchema: DurableSchema
}

export interface RecoveryPolicy {
  readonly mode: "repeatable" | "downstream-deduplicated" | "manual"
  readonly maxAttempts: number
  readonly retryTypedFailures?: boolean
  readonly delayMs?: number
}

export type ReusePolicy =
  | { readonly kind: "execution" }
  | {
    readonly kind: "memo"
    readonly scope: string
    readonly generation: string
    readonly keyVersion: string
  }
  | {
    readonly kind: "content"
    readonly invalidationSalt?: string
  }

export interface SerializableProviderPolicy {
  readonly recovery: RecoveryPolicy
  readonly reuse: ReusePolicy
  readonly dependencyDigests: readonly string[]
  readonly capabilityGrant: readonly string[]
  readonly target: string
}

/**
 * Serializable evidence emitted by the Smithers whole-project row pass for one
 * concrete Action implementation. The in-memory compiler also authenticates
 * the object before `Provider.provideChecked` accepts it; this shape is the
 * frozen evidence retained in deployment artifacts.
 */
export interface ActionImplementationContract {
  readonly formatVersion: 2
  readonly source: "compiler-derived"
  readonly compilerIdentity: "smithers-action-implementation-v2"
  readonly implementationId: string
  readonly implementationVersion: string
  readonly actionId: string
  readonly actionVersion: number
  readonly actionContractDigest: string
  readonly actionErrorSchemaDigest: string
  readonly entryFile: string
  readonly exportName: string
  readonly projectDigest: string
  /**
   * Canonical emitted-JavaScript identity derived from the checked source
   * export only. It is source evidence, not live callback or bundle identity.
   */
  readonly checkedExportDigest: string
  readonly requirements: readonly string[]
  /** Recoverable Error row only; Panic is never encoded into this list. */
  readonly typedFailures: readonly string[]
  /** Unexpected defect channel inferred independently from typed failures. */
  readonly panic: boolean
  /** Exact compiler-derived structural schema, or null for the infallible legacy compatibility path. */
  readonly failureSchemaDigest: string | null
  readonly digest: string
}

export interface WorkerPoolManifest {
  readonly id: string
  readonly target: string
  readonly sandbox: string
  readonly placement: Readonly<Record<string, JsonValue>>
  readonly artifactDigest: string
  readonly actionIds: readonly string[]
  /**
   * SHA-256 of the pool's emitted tree-shaken worker bundle bytes. Present
   * exactly when the pool was built with bundle emission; it participates in
   * `artifactDigest`, the manifest digest, and the deployment signature, so
   * signing the manifest pins the worker bundle content.
   */
  readonly bundleDigest?: string
}

export interface ActionRouteManifest {
  readonly actionId: string
  readonly actionVersion: number
  readonly actionContractDigest: string
  readonly poolId: string
  readonly artifactDigest: string
  readonly implementationDigest: string
  /** `null` identifies the authority-free legacy provider path. */
  readonly implementationContract: ActionImplementationContract | null
  readonly policyDigest: string
  readonly policy: SerializableProviderPolicy
  readonly schemas: {
    readonly input: DurableSchema
    readonly success: DurableSchema
    readonly error: DurableSchema
  }
}

export interface DeploymentManifest {
  readonly formatVersion: 1
  readonly deploymentId: string
  readonly planDigest: string
  readonly coordinatorDigest: string
  readonly pools: readonly WorkerPoolManifest[]
  readonly routes: readonly ActionRouteManifest[]
  readonly digest: string
}

export interface Invocation {
  readonly schemaVersion: 1
  readonly executionId: string
  readonly nodeId: string
  readonly attempt: number
  readonly actionId: string
  readonly actionVersion: number
  readonly actionContractDigest: string
  readonly implementationDigest: string
  readonly input: JsonValue
  readonly deadline: number
  readonly downstreamIdempotencyKey: string
  readonly capabilityGrant: readonly string[]
  /**
   * Ownership evidence for this attempt, as it stood at claim time.
   *
   * `expiresAt` is a SNAPSHOT. The coordinator renews this lease in the store
   * every `leaseMs/3` for as long as the attempt runs, and this field is never
   * restamped, so it is stale before the first heartbeat lands. It is here for
   * identity and diagnostics only: never derive an execution budget from it.
   * `budget` is the field that says how long the work may run.
   */
  readonly lease: {
    readonly owner: string
    readonly expiresAt: number
  }
  /**
   * The coordinator's committed execution budget for this attempt: the absolute
   * wall-clock instant after which no transport may let this attempt's work keep
   * running. The coordinator derives it once (`DurableExecutor`), because it is
   * the only party that knows the lease it is actively renewing, and every
   * transport enforces exactly this horizon. That is what makes an Action that
   * outlives `leaseMs` behave identically in-process, isolated, bundled, and
   * remote.
   */
  readonly budget: {
    readonly expiresAt: number
  }
  readonly fencingToken: number
  readonly traceContext: Readonly<Record<string, string>>
}

export type WorkerExit =
  | { readonly kind: "success"; readonly value: JsonValue }
  | { readonly kind: "failure"; readonly error: JsonValue }
  | {
    readonly kind: "defect"
    readonly defect: { readonly name: string; readonly message: string; readonly stack?: string }
  }

export const derivedSchema = (role: DurableSchema["role"]): DurableSchema => {
  const semantic = {
    format: "canonical-json" as const,
    schemaVersion: 1 as const,
    role,
    shape: "json-value" as const,
    source: "compiler-derived-poc-stub" as const
  }
  return Object.freeze({ ...semantic, digest: digest(semantic) })
}

export const structuralSchema = (
  role: DurableSchema["role"],
  descriptor: DurableTypeDescriptor
): StructuralDurableSchema => {
  const semantic = {
    format: "canonical-json" as const,
    schemaVersion: 1 as const,
    role,
    shape: "structural" as const,
    source: "compiler-derived" as const,
    descriptor: deepFreeze(descriptor)
  }
  return deepFreeze({ ...semantic, digest: digest(semantic) })
}

/** Recursively freezes JSON/IR-shaped objects so a digest cannot outlive mutable semantics. */
export const deepFreeze = <Value>(value: Value, seen = new WeakSet<object>()): Value => {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value
  const object = value as object
  if (seen.has(object)) return value
  seen.add(object)
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    if (descriptor !== undefined && "value" in descriptor) deepFreeze(descriptor.value, seen)
  }
  return Object.isFrozen(object) ? value : Object.freeze(value)
}

const assertUnicodeScalarString = (value: string, path: string): string => {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError(`${path} is not durable JSON: unpaired high surrogate`)
      }
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError(`${path} is not durable JSON: unpaired low surrogate`)
    }
  }
  return value
}

const MAX_JSON_DEPTH = 256
/** Bounds work before canonical encoding applies its independent 8 MiB limit. */
export const MAX_DURABLE_JSON_NODES = 100_000

const assertJsonInner = (
  value: unknown,
  path: string,
  seen: Set<object>,
  depth: number,
  budget: { nodes: number }
): JsonValue => {
  if (depth > MAX_JSON_DEPTH) throw new TypeError(`${path} is not durable JSON: nesting limit exceeded`)
  budget.nodes += 1
  if (budget.nodes > MAX_DURABLE_JSON_NODES) {
    throw new TypeError(`${path} is not durable JSON: node limit exceeded`)
  }
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "string") return assertUnicodeScalarString(value, path)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} is not durable JSON: non-finite number`)
    if (Object.is(value, -0)) throw new TypeError(`${path} is not durable JSON: negative zero`)
    return value
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} is not durable JSON: ${typeof value}`)
  }
  if (seen.has(value)) throw new TypeError(`${path} is not durable JSON: cyclic value`)
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value)
      if (ownKeys.length > MAX_DURABLE_JSON_NODES + 1) {
        throw new TypeError(`${path} is not durable JSON: own-field limit exceeded`)
      }
      for (const key of ownKeys) {
        if (key === "length") continue
        if (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length) {
          throw new TypeError(`${path} is not durable JSON: unexpected array property ${String(key)}`)
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!
        if (!("value" in descriptor) || !descriptor.enumerable) {
          throw new TypeError(`${path}[${key}] is not durable JSON: accessor or hidden property`)
        }
      }
      const out: JsonValue[] = []
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new TypeError(`${path}[${index}] is not durable JSON: sparse array hole`)
        out.push(assertJsonInner(value[index], `${path}[${index}]`, seen, depth + 1, budget))
      }
      return out
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} is not durable JSON: ${prototype?.constructor?.name ?? "exotic object"}`)
    }
    // A null prototype keeps an own "__proto__" field as data instead of
    // mutating the normalization object and disappearing from its hash.
    const out = Object.create(null) as Record<string, JsonValue>
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.length > MAX_DURABLE_JSON_NODES) {
      throw new TypeError(`${path} is not durable JSON: own-field limit exceeded`)
    }
    for (const key of ownKeys) {
      if (typeof key !== "string") throw new TypeError(`${path} is not durable JSON: symbol property`)
      assertUnicodeScalarString(key, `${path} key`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (!("value" in descriptor) || !descriptor.enumerable) {
        throw new TypeError(`${path}.${key} is not durable JSON: accessor or hidden property`)
      }
    }
    for (const key of Object.keys(value).sort()) {
      out[key] = assertJsonInner(
        Object.getOwnPropertyDescriptor(value, key)!.value,
        `${path}.${key}`,
        seen,
        depth + 1,
        budget
      )
    }
    return out
  } finally {
    seen.delete(value)
  }
}

export const assertJson = (value: unknown, label = "value"): JsonValue =>
  assertJsonInner(value, label, new Set(), 0, { nodes: 0 })

const canonicalFromJson = (value: JsonValue): string => {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalFromJson).join(",")}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalFromJson(value[key])}`).join(",")}}`
}

export const canonicalJson = (value: unknown): string => {
  const encoded = canonicalFromJson(assertJson(value))
  if (new TextEncoder().encode(encoded).byteLength > 8 * 1024 * 1024) {
    throw new TypeError("durable JSON exceeds the canonical message size limit; use an Artifact reference")
  }
  return encoded
}

export const encodeCanonicalJson = (value: unknown): Uint8Array =>
  new TextEncoder().encode(canonicalJson(value))

export const decodeCanonicalJson = (bytes: Uint8Array | string, label = "canonical JSON"): JsonValue => {
  const byteLength = typeof bytes === "string" ? new TextEncoder().encode(bytes).byteLength : bytes.byteLength
  if (byteLength > 8 * 1024 * 1024) throw new TypeError(`${label} exceeds the canonical message size limit`)
  const text = typeof bytes === "string"
    ? bytes
    : new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new TypeError(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const value = assertJson(parsed, label)
  if (canonicalFromJson(value) !== text) {
    throw new TypeError(`${label} is not in the canonical durable encoding`)
  }
  return deepFreeze(value)
}

export const digest = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value)).digest("hex")

export const uniqueSorted = (values: Iterable<string>): readonly string[] => [...new Set(values)].sort()
