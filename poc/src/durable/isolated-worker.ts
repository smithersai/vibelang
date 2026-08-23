import { DenoSubprocessSandbox } from "../agent/sandbox.ts"
import type { ComponentIdentity } from "../agent/types.ts"
import {
  assertJson,
  canonicalJson,
  deepFreeze,
  digest,
  type DeploymentManifest,
  type Invocation,
  type JsonValue,
  type WorkerExit
} from "./ir.ts"
import {
  LocalWorker,
  type ActionProvider,
  type DurableWorker,
  type WorkerPool
} from "./provider.ts"

const MAX_ISOLATED_ARTIFACT_BYTES = 1024 * 1024
const HEX_DIGEST = /^[0-9a-f]{64}$/

export interface DenoIsolatedWorkerArtifact {
  readonly formatVersion: 1
  readonly poolId: string
  /** Compiler-emitted JavaScript expression evaluating to `(invocation) => WorkerExit`. */
  readonly functionExpression: string
  readonly sourceDigest: string
  readonly sandboxIdentity: ComponentIdentity
  /** Pin included in every selected provider's dependencyDigests. */
  readonly digest: string
}

const identitySnapshot = (identity: ComponentIdentity): ComponentIdentity => {
  const normalized = assertJson(identity, "isolated worker sandbox identity") as unknown
  if (
    normalized === null || typeof normalized !== "object" || Array.isArray(normalized) ||
    canonicalJson(Object.keys(normalized).sort()) !==
      canonicalJson(["artifactDigest", "configDigest", "name"]) ||
    typeof (normalized as ComponentIdentity).name !== "string" ||
    (normalized as ComponentIdentity).name.trim() === "" ||
    !HEX_DIGEST.test((normalized as ComponentIdentity).artifactDigest) ||
    !HEX_DIGEST.test((normalized as ComponentIdentity).configDigest)
  ) {
    throw new TypeError("Isolated worker sandbox identity is invalid")
  }
  return deepFreeze(normalized as ComponentIdentity)
}

const artifactSemantic = (
  poolId: string,
  functionExpression: string,
  sourceDigest: string,
  sandboxIdentity: ComponentIdentity
) => ({
  formatVersion: 1 as const,
  poolId,
  functionExpression,
  sourceDigest,
  sandboxIdentity
})

export const createDenoIsolatedWorkerArtifact = (options: {
  readonly poolId: string
  readonly functionExpression: string
  readonly sandbox: DenoSubprocessSandbox
}): DenoIsolatedWorkerArtifact => {
  if (!(options.sandbox instanceof DenoSubprocessSandbox)) {
    throw new TypeError("Isolated worker artifacts require the authenticated Deno subprocess sandbox")
  }
  const poolId = options.poolId
  const functionExpression = assertJson(
    options.functionExpression,
    "isolated worker function expression"
  ) as string
  if (typeof poolId !== "string" || poolId.trim() === "") {
    throw new TypeError("Isolated worker pool id must be non-empty")
  }
  const sourceBytes = Buffer.byteLength(functionExpression, "utf8")
  if (functionExpression.trim() === "" || sourceBytes > MAX_ISOLATED_ARTIFACT_BYTES) {
    throw new RangeError(
      `Isolated worker source must contain 1-${MAX_ISOLATED_ARTIFACT_BYTES} UTF-8 bytes`
    )
  }
  const sourceDigest = digest(functionExpression)
  const sandboxIdentity = identitySnapshot(options.sandbox.identity)
  const semantic = artifactSemantic(poolId, functionExpression, sourceDigest, sandboxIdentity)
  return deepFreeze({ ...semantic, digest: digest(semantic) })
}

const validateArtifact = (raw: DenoIsolatedWorkerArtifact): DenoIsolatedWorkerArtifact => {
  const artifact = assertJson(raw, "isolated worker artifact") as unknown
  if (
    artifact === null || typeof artifact !== "object" || Array.isArray(artifact) ||
    canonicalJson(Object.keys(artifact).sort()) !== canonicalJson([
      "digest", "formatVersion", "functionExpression", "poolId", "sandboxIdentity", "sourceDigest"
    ])
  ) {
    throw new TypeError("Isolated worker artifact has an invalid envelope")
  }
  const candidate = artifact as DenoIsolatedWorkerArtifact
  if (
    candidate.formatVersion !== 1 ||
    typeof candidate.poolId !== "string" || candidate.poolId.trim() === "" ||
    typeof candidate.functionExpression !== "string" || candidate.functionExpression.trim() === "" ||
    Buffer.byteLength(candidate.functionExpression, "utf8") > MAX_ISOLATED_ARTIFACT_BYTES ||
    !HEX_DIGEST.test(candidate.sourceDigest) ||
    !HEX_DIGEST.test(candidate.digest)
  ) {
    throw new TypeError("Isolated worker artifact has invalid fields")
  }
  const sandboxIdentity = identitySnapshot(candidate.sandboxIdentity)
  const expectedSourceDigest = digest(candidate.functionExpression)
  const semantic = artifactSemantic(
    candidate.poolId,
    candidate.functionExpression,
    candidate.sourceDigest,
    sandboxIdentity
  )
  if (candidate.sourceDigest !== expectedSourceDigest || candidate.digest !== digest(semantic)) {
    throw new TypeError("Isolated worker artifact digest mismatch")
  }
  return deepFreeze({ ...semantic, digest: candidate.digest })
}

const sameIdentity = (left: ComponentIdentity, right: ComponentIdentity): boolean =>
  canonicalJson(left) === canonicalJson(right)

/**
 * Executes a compiler-emitted worker artifact in a fresh, zero-permission Deno
 * process. The host provider table is used only to authenticate the deployment
 * manifest; provider implementation functions never cross into or run in the
 * coordinator process on this path.
 */
export class DenoIsolatedWorker implements DurableWorker {
  readonly artifact: DenoIsolatedWorkerArtifact
  readonly #gate: LocalWorker
  readonly #sandbox: DenoSubprocessSandbox

  constructor(
    pool: WorkerPool,
    manifest: DeploymentManifest,
    providers: ReadonlyMap<string, ActionProvider<any, any, any>>,
    options: {
      readonly artifact: DenoIsolatedWorkerArtifact
      readonly sandbox: DenoSubprocessSandbox
    }
  ) {
    if (!(options.sandbox instanceof DenoSubprocessSandbox)) {
      throw new TypeError("DenoIsolatedWorker requires the authenticated Deno subprocess sandbox")
    }
    this.artifact = validateArtifact(options.artifact)
    this.#sandbox = options.sandbox
    if (
      pool.id !== this.artifact.poolId ||
      pool.sandbox !== this.#sandbox.kind ||
      !sameIdentity(this.artifact.sandboxIdentity, this.#sandbox.identity)
    ) {
      throw new TypeError(`Isolated worker artifact/runtime does not match pool ${pool.id}`)
    }
    const routes = manifest.routes.filter((route) => route.poolId === pool.id)
    if (routes.length === 0) throw new TypeError(`Isolated worker pool ${pool.id} has no routes`)
    for (const route of routes) {
      const provider = providers.get(route.actionId)
      if (
        provider === undefined ||
        !route.policy.dependencyDigests.includes(this.artifact.digest) ||
        !provider.dependencyDigests.includes(this.artifact.digest)
      ) {
        throw new TypeError(
          `Provider ${route.actionId} does not pin isolated artifact ${this.artifact.digest}`
        )
      }
    }
    this.#gate = new LocalWorker(pool, manifest, providers)
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
    const invocationBytes = canonicalJson(invocation)
    const javascript = [
      `const __smithersInvocation = JSON.parse(${JSON.stringify(invocationBytes)});`,
      `const __smithersHandler = (${this.artifact.functionExpression});`,
      "export default async function __smithersWorkerMain() {",
      "  if (typeof __smithersHandler !== 'function') throw new TypeError('Worker artifact must evaluate to a function');",
      "  return await Reflect.apply(__smithersHandler, undefined, [__smithersInvocation]);",
      "}"
    ].join("\n")
    const execution = await this.#sandbox.execute(javascript, {}, {
      sourceDigest: this.artifact.sourceDigest,
      turnId: digest({
        executionId: invocation.executionId,
        nodeId: invocation.nodeId,
        attempt: invocation.attempt,
        fencingToken: invocation.fencingToken
      }),
      signal
    })
    if (!execution.ok) {
      return {
        kind: "defect",
        defect: {
          name: execution.error?.name ?? "IsolatedWorkerDefect",
          message: execution.error?.message ?? "Isolated worker exited without a result",
          ...(execution.error?.stack === undefined ? {} : { stack: execution.error.stack })
        }
      }
    }
    // The coordinator applies its exact WorkerExit discriminant and structural
    // Action codecs before this value can be persisted or cached.
    return execution.result as JsonValue as WorkerExit
  }
}
