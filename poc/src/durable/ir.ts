import { createHash } from "node:crypto"

/** JSON is the deliberately narrow persistence boundary used by this POC. */
export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue }

export interface DurableSchema {
  readonly format: "canonical-json"
  /** The real compiler will replace this marker with a derived schema. */
  readonly source: "compiler-derived-poc-stub"
}

export interface ActionDescriptor {
  readonly id: string
  readonly version: number
  /** Temporary seam for the compiler-emitted schema/contract identity. */
  readonly contractDigest: string
  readonly inputSchema: DurableSchema
  readonly successSchema: DurableSchema
  readonly errorSchema: DurableSchema
}

export type UnaryOperator = "not"
export type BinaryOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "and"
  | "or"
  | "add"
  | "concat"

/** Portable values are the only values allowed to cross plan/runtime phases. */
export type ValueExpr =
  | { readonly kind: "literal"; readonly value: JsonValue }
  | { readonly kind: "input"; readonly path: readonly string[] }
  | { readonly kind: "node"; readonly nodeId: string; readonly path: readonly string[] }
  | { readonly kind: "array"; readonly items: readonly ValueExpr[] }
  | { readonly kind: "object"; readonly fields: Readonly<Record<string, ValueExpr>> }
  | { readonly kind: "unary"; readonly operator: UnaryOperator; readonly value: ValueExpr }
  | {
    readonly kind: "binary"
    readonly operator: BinaryOperator
    readonly left: ValueExpr
    readonly right: ValueExpr
  }

export interface NodeBase {
  readonly id: string
  readonly dependencies: readonly string[]
  readonly controlDependencies: readonly string[]
  readonly debug?: { readonly label?: string; readonly callSite?: string }
}

export interface ActionNode extends NodeBase {
  readonly kind: "action"
  readonly actionId: string
  readonly actionVersion: number
  readonly actionContractDigest: string
  readonly input: ValueExpr
}

export interface ParallelNode extends NodeBase {
  readonly kind: "parallel"
  readonly outputs: readonly ValueExpr[]
}

export interface BranchNode extends NodeBase {
  readonly kind: "branch"
  readonly condition: ValueExpr
  readonly whenTrue: PlanFragment
  readonly whenFalse: PlanFragment
}

export type PlanNode = ActionNode | ParallelNode | BranchNode

export interface PlanFragment {
  readonly nodes: readonly PlanNode[]
  readonly output: ValueExpr
}

export interface PlanTemplate extends PlanFragment {
  readonly formatVersion: 1
  readonly flowId: string
  readonly flowVersion: number
  readonly requirements: readonly string[]
  readonly actions: readonly ActionDescriptor[]
  readonly digest: string
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
  readonly target: string
}

export interface WorkerPoolManifest {
  readonly id: string
  readonly target: string
  readonly sandbox: string
  readonly placement: Readonly<Record<string, JsonValue>>
  readonly artifactDigest: string
  readonly actionIds: readonly string[]
}

export interface ActionRouteManifest {
  readonly actionId: string
  readonly actionVersion: number
  readonly actionContractDigest: string
  readonly poolId: string
  readonly artifactDigest: string
  readonly implementationDigest: string
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
  readonly lease: {
    readonly owner: string
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

export const derivedSchema = (): DurableSchema => Object.freeze({
  format: "canonical-json",
  source: "compiler-derived-poc-stub"
})

/** Recursively freezes JSON/IR-shaped objects so a digest cannot outlive mutable semantics. */
export const deepFreeze = <Value>(value: Value, seen = new WeakSet<object>()): Value => {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value
  const object = value as object
  if (seen.has(object) || Object.isFrozen(object)) return value
  seen.add(object)
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    if (descriptor !== undefined && "value" in descriptor) deepFreeze(descriptor.value, seen)
  }
  return Object.freeze(value)
}

const assertJsonInner = (value: unknown, path: string, seen: Set<object>): JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} is not durable JSON: non-finite number`)
    return value
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} is not durable JSON: ${typeof value}`)
  }
  if (seen.has(value)) throw new TypeError(`${path} is not durable JSON: cyclic value`)
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const out: JsonValue[] = []
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new TypeError(`${path}[${index}] is not durable JSON: sparse array hole`)
        out.push(assertJsonInner(value[index], `${path}[${index}]`, seen))
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
    for (const key of Object.keys(value).sort()) {
      out[key] = assertJsonInner((value as Record<string, unknown>)[key], `${path}.${key}`, seen)
    }
    return out
  } finally {
    seen.delete(value)
  }
}

export const assertJson = (value: unknown, label = "value"): JsonValue =>
  assertJsonInner(value, label, new Set())

const canonicalFromJson = (value: JsonValue): string => {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalFromJson).join(",")}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalFromJson(value[key])}`).join(",")}}`
}

export const canonicalJson = (value: unknown): string => canonicalFromJson(assertJson(value))

export const digest = (value: unknown): string =>
  createHash("sha256").update(canonicalJson(value)).digest("hex")

export const uniqueSorted = (values: Iterable<string>): readonly string[] => [...new Set(values)].sort()

export const expressionDependencies = (expression: ValueExpr): readonly string[] => {
  const found = new Set<string>()
  const pending: ValueExpr[] = [expression]
  while (pending.length > 0) {
    const current = pending.pop()!
    switch (current.kind) {
      case "node":
        found.add(current.nodeId)
        break
      case "array":
        pending.push(...current.items)
        break
      case "object":
        pending.push(...Object.values(current.fields))
        break
      case "unary":
        pending.push(current.value)
        break
      case "binary":
        pending.push(current.left, current.right)
        break
      case "input":
      case "literal":
        break
    }
  }
  return uniqueSorted(found)
}

export const allPlanNodes = (fragment: PlanFragment): readonly PlanNode[] => {
  const out: PlanNode[] = []
  const visit = (value: PlanFragment): void => {
    for (const node of value.nodes) {
      out.push(node)
      if (node.kind === "branch") {
        visit(node.whenTrue)
        visit(node.whenFalse)
      }
    }
  }
  visit(fragment)
  return out
}

export const fragmentNodeIds = (fragment: PlanFragment): readonly string[] =>
  allPlanNodes(fragment).map((node) => node.id)
