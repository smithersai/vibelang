import type { CompiledFlow, DurableAction } from "./authoring.ts"
import {
  allPlanNodes,
  assertJson,
  type ActionRouteManifest,
  type DeploymentManifest,
  deepFreeze,
  digest,
  type Invocation,
  type JsonValue,
  type RecoveryPolicy,
  type ReusePolicy,
  type SerializableProviderPolicy,
  type WorkerExit,
  type WorkerPoolManifest
} from "./ir.ts"
import { ActionFailure } from "./authoring.ts"

export interface ActionExecutionContext {
  readonly invocation: Invocation
  /** In-process POC cancellation signal; production workers enforce this out of process. */
  readonly signal: AbortSignal
}

export type ActionImplementation<Input, Success> = (
  input: Input,
  context: ActionExecutionContext
) => Success | Promise<Success>

export type ProviderReuse<Input> =
  | { readonly kind: "execution" }
  | {
    readonly kind: "memo"
    readonly scope: string
    readonly generation: string
    readonly keyVersion: string
    /** Memoization is an explicit semantic choice, never inferred from payload equality. */
    readonly key: (input: Input) => string
  }
  | {
    readonly kind: "content"
    readonly invalidationSalt?: string
  }

export interface ProviderOptions<Input> {
  readonly implementationId: string
  readonly implementationVersion: string
  readonly recovery?: RecoveryPolicy
  readonly reuse?: ProviderReuse<Input>
  readonly dependencyDigests?: readonly string[]
  /** "any" permits this implementation in any TypeScript POC pool. */
  readonly target?: string
}

export interface ActionProvider<Input = unknown, Success = unknown, Failure = unknown> {
  readonly action: DurableAction<Input, Success, Failure>
  readonly implementation: ActionImplementation<Input, Success>
  readonly implementationId: string
  readonly implementationVersion: string
  readonly actionContractDigest: string
  readonly implementationDigest: string
  readonly policyDigest: string
  readonly recovery: RecoveryPolicy
  readonly reuse: ProviderReuse<Input>
  readonly dependencyDigests: readonly string[]
  readonly target: string
}

const defaultRecovery: RecoveryPolicy = Object.freeze({
  mode: "manual",
  maxAttempts: 1
})

const serializableReuse = (reuse: ProviderReuse<unknown>): ReusePolicy => {
  switch (reuse.kind) {
    case "execution":
      return reuse
    case "memo":
      return {
        kind: "memo",
        scope: reuse.scope,
        generation: reuse.generation,
        keyVersion: reuse.keyVersion
      }
    case "content":
      return {
        kind: "content",
        ...(reuse.invalidationSalt === undefined ? {} : { invalidationSalt: reuse.invalidationSalt })
      }
  }
}

const validateRecovery = (actionId: string, recovery: RecoveryPolicy): void => {
  if (!Number.isSafeInteger(recovery.maxAttempts) || recovery.maxAttempts < 1) {
    throw new TypeError(`Provider for ${actionId} has invalid maxAttempts`)
  }
  if (recovery.delayMs !== undefined && (!Number.isFinite(recovery.delayMs) || recovery.delayMs < 0)) {
    throw new TypeError(`Provider for ${actionId} has invalid retry delay`)
  }
}

const provide = <Input, Success, Failure>(
  action: DurableAction<Input, Success, Failure>,
  implementation: ActionImplementation<Input, Success>,
  options: ProviderOptions<Input>
): ActionProvider<Input, Success, Failure> => {
  if (options.implementationId.trim() === "" || options.implementationVersion.trim() === "") {
    throw new TypeError(`Provider for ${action.descriptor.id} needs explicit implementation identity and version`)
  }
  const recovery: RecoveryPolicy = Object.freeze({ ...(options.recovery ?? defaultRecovery) })
  const requestedReuse = options.reuse ?? { kind: "execution" }
  const reuse: ProviderReuse<Input> = requestedReuse.kind === "memo"
    ? Object.freeze({ ...requestedReuse })
    : requestedReuse.kind === "content"
      ? Object.freeze({ ...requestedReuse })
      : Object.freeze({ kind: "execution" })
  validateRecovery(action.descriptor.id, recovery)
  if (
    reuse.kind === "memo" &&
    (reuse.scope.trim() === "" || reuse.generation.trim() === "" || reuse.keyVersion.trim() === "")
  ) {
    throw new TypeError(`Memo provider for ${action.descriptor.id} needs scope, generation, and keyVersion`)
  }
  const dependencyDigests = Object.freeze([...new Set(options.dependencyDigests ?? [])].sort())
  const target = options.target ?? "any"
  const implementationDigest = digest({
    implementationId: options.implementationId,
    implementationVersion: options.implementationVersion,
    actionId: action.descriptor.id,
    actionVersion: action.descriptor.version,
    actionContractDigest: action.descriptor.contractDigest,
    dependencyDigests,
    target
  })
  const policyDigest = digest({ recovery, reuse: serializableReuse(reuse as ProviderReuse<unknown>) })
  return Object.freeze({
    action,
    implementation,
    implementationId: options.implementationId,
    implementationVersion: options.implementationVersion,
    actionContractDigest: action.descriptor.contractDigest,
    implementationDigest,
    policyDigest,
    recovery,
    reuse,
    dependencyDigests,
    target
  })
}

export interface WorkerPool {
  readonly id: string
  readonly target: string
  readonly sandbox: string
  readonly placement: Readonly<Record<string, JsonValue>>
  readonly providers: readonly ActionProvider<any, any, any>[]
}

export interface WorkerPoolOptions {
  readonly target: string
  readonly sandbox?: string
  readonly placement?: Readonly<Record<string, unknown>>
  readonly providers: readonly ActionProvider<any, any, any>[]
}

const pool = (id: string, options: WorkerPoolOptions): WorkerPool => {
  if (id.trim() === "") throw new TypeError("Worker pool id must be non-empty")
  if (options.target.trim() === "") throw new TypeError(`Worker pool ${id} target must be non-empty`)
  const placement = assertJson(options.placement ?? {}, `Worker pool ${id} placement`)
  if (Array.isArray(placement) || placement === null || typeof placement !== "object") {
    throw new TypeError(`Worker pool ${id} placement must be an object`)
  }
  return Object.freeze({
    id,
    target: options.target,
    sandbox: options.sandbox ?? "in-process-poc",
    placement: deepFreeze(placement),
    providers: Object.freeze([...options.providers])
  })
}

export interface BuiltDeployment<Input = unknown, Success = unknown> {
  readonly flow: CompiledFlow<Input, Success>
  readonly manifest: DeploymentManifest
  /** Runtime code is intentionally outside the serializable coordinator manifest. */
  readonly providers: ReadonlyMap<string, ActionProvider<any, any, any>>
  readonly pools: ReadonlyMap<string, WorkerPool>
}

const policyFor = (provider: ActionProvider<any, any, any>, pool: WorkerPool): SerializableProviderPolicy => ({
  recovery: provider.recovery,
  reuse: serializableReuse(provider.reuse as ProviderReuse<unknown>),
  dependencyDigests: provider.dependencyDigests,
  target: pool.target
})

const buildDeployment = <Input, Success>(options: {
  readonly id: string
  readonly flow: CompiledFlow<Input, Success>
  readonly pools: readonly WorkerPool[]
}): BuiltDeployment<Input, Success> => {
  if (options.id.trim() === "") throw new TypeError("Deployment id must be non-empty")
  const plannedActions = new Map(options.flow.plan.actions.map((action) => [action.id, action]))
  for (const node of allPlanNodes(options.flow.plan)) {
    if (node.kind !== "action") continue
    const descriptor = plannedActions.get(node.actionId)
    if (
      descriptor === undefined ||
      node.actionVersion !== descriptor.version ||
      node.actionContractDigest !== descriptor.contractDigest
    ) {
      throw new Error(`Plan node ${node.id} has an Action version/schema contract mismatch for ${node.actionId}`)
    }
  }
  const poolsById = new Map<string, WorkerPool>()
  const candidates = new Map<string, { provider: ActionProvider<any, any, any>; pool: WorkerPool }>()
  for (const workerPool of options.pools) {
    if (poolsById.has(workerPool.id)) throw new Error(`Duplicate worker pool ${workerPool.id}`)
    poolsById.set(workerPool.id, workerPool)
    for (const provider of workerPool.providers) {
      const actionId = provider.action.descriptor.id
      if (!options.flow.plan.requirements.includes(actionId)) continue // tree shake unused implementations
      const plannedDescriptor = options.flow.plan.actions.find((action) => action.id === actionId)
      if (
        plannedDescriptor === undefined ||
        plannedDescriptor.version !== provider.action.descriptor.version ||
        plannedDescriptor.contractDigest !== provider.actionContractDigest ||
        provider.action.descriptor.contractDigest !== provider.actionContractDigest
      ) {
        throw new Error(
          `Provider ${provider.implementationId} has an Action version/schema contract mismatch for ${actionId}`
        )
      }
      if (plannedDescriptor !== provider.action.descriptor) {
        throw new Error(
          `Provider ${provider.implementationId} uses a different nominal descriptor for ${actionId}`
        )
      }
      if (provider.target !== "any" && provider.target !== workerPool.target) {
        throw new Error(
          `Provider ${provider.implementationId} targets ${provider.target}, incompatible with pool ${workerPool.id} (${workerPool.target})`
        )
      }
      const prior = candidates.get(actionId)
      if (prior !== undefined) {
        throw new Error(
          `Action ${actionId} has ambiguous providers in pools ${prior.pool.id} and ${workerPool.id}; selection must be pinned`
        )
      }
      candidates.set(actionId, { provider, pool: workerPool })
    }
  }
  for (const required of options.flow.plan.requirements) {
    if (!candidates.has(required)) {
      throw new Error(`Deployment ${options.id} is missing provider required by Flow: ${required}`)
    }
  }

  const artifactByPool = new Map<string, string>()
  for (const workerPool of options.pools) {
    const selected = [...candidates.entries()]
      .filter(([, candidate]) => candidate.pool.id === workerPool.id)
      .map(([actionId, candidate]) => ({
        actionId,
        implementationDigest: candidate.provider.implementationDigest,
        policyDigest: candidate.provider.policyDigest
      }))
      .sort((left, right) => left.actionId.localeCompare(right.actionId))
    artifactByPool.set(
      workerPool.id,
      digest({ poolId: workerPool.id, target: workerPool.target, sandbox: workerPool.sandbox, selected })
    )
  }

  const poolManifests: WorkerPoolManifest[] = options.pools.map((workerPool) => ({
    id: workerPool.id,
    target: workerPool.target,
    sandbox: workerPool.sandbox,
    placement: workerPool.placement,
    artifactDigest: artifactByPool.get(workerPool.id)!,
    actionIds: [...candidates.entries()]
      .filter(([, candidate]) => candidate.pool.id === workerPool.id)
      .map(([actionId]) => actionId)
      .sort()
  }))
  const routes: ActionRouteManifest[] = [...candidates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([actionId, candidate]) => ({
      actionId,
      actionVersion: candidate.provider.action.descriptor.version,
      actionContractDigest: candidate.provider.actionContractDigest,
      poolId: candidate.pool.id,
      artifactDigest: artifactByPool.get(candidate.pool.id)!,
      implementationDigest: candidate.provider.implementationDigest,
      policyDigest: candidate.provider.policyDigest,
      policy: policyFor(candidate.provider, candidate.pool),
      schemas: {
        input: candidate.provider.action.descriptor.inputSchema,
        success: candidate.provider.action.descriptor.successSchema,
        error: candidate.provider.action.descriptor.errorSchema
      }
    }))
  const coordinatorDigest = digest({
    planDigest: options.flow.plan.digest,
    routes: routes.map(({ actionId, poolId, implementationDigest, policyDigest }) => ({
      actionId,
      poolId,
      implementationDigest,
      policyDigest
    }))
  })
  const unsigned = {
    formatVersion: 1 as const,
    deploymentId: options.id,
    planDigest: options.flow.plan.digest,
    coordinatorDigest,
    pools: poolManifests,
    routes
  }
  const manifest: DeploymentManifest = deepFreeze({ ...unsigned, digest: digest(unsigned) })
  return Object.freeze({
    flow: options.flow,
    manifest,
    providers: new Map([...candidates].map(([actionId, candidate]) => [actionId, candidate.provider])),
    pools: poolsById
  })
}

export const Provider = { provide } as const
export const Worker = { pool } as const
export const Deployment = { build: buildDeployment } as const

/**
 * A structured-clone-shaped worker boundary. It verifies the exact artifact,
 * route, implementation digest and action version before invoking ordinary code.
 */
export class LocalWorker {
  readonly artifactDigest: string
  readonly actionTable: readonly string[]

  constructor(
    readonly pool: WorkerPool,
    readonly manifest: DeploymentManifest,
    readonly providers: ReadonlyMap<string, ActionProvider<any, any, any>>
  ) {
    const poolManifest = manifest.pools.find((candidate) => candidate.id === pool.id)
    if (poolManifest === undefined) throw new Error(`Pool ${pool.id} absent from deployment manifest`)
    this.artifactDigest = poolManifest.artifactDigest
    this.actionTable = poolManifest.actionIds
  }

  async invoke(rawInvocation: Invocation, signal: AbortSignal = new AbortController().signal): Promise<WorkerExit> {
    // A JSON round trip makes accidental process-local values fail at the protocol boundary.
    const invocation = JSON.parse(JSON.stringify(rawInvocation)) as Invocation
    const route = this.manifest.routes.find((candidate) => candidate.actionId === invocation.actionId)
    if (route === undefined || route.poolId !== this.pool.id) {
      return { kind: "defect", defect: { name: "RoutingDefect", message: `No route for ${invocation.actionId}` } }
    }
    const provider = this.providers.get(invocation.actionId)
    if (
      provider === undefined ||
      !this.actionTable.includes(invocation.actionId) ||
      route.artifactDigest !== this.artifactDigest ||
      route.actionVersion !== invocation.actionVersion ||
      route.actionContractDigest !== invocation.actionContractDigest ||
      route.implementationDigest !== invocation.implementationDigest ||
      route.policyDigest !== provider.policyDigest ||
      provider.implementationDigest !== invocation.implementationDigest ||
      provider.action.descriptor.id !== invocation.actionId ||
      provider.action.descriptor.version !== invocation.actionVersion ||
      provider.actionContractDigest !== invocation.actionContractDigest ||
      provider.action.descriptor.contractDigest !== invocation.actionContractDigest
    ) {
      return {
        kind: "defect",
        defect: { name: "ManifestVerificationDefect", message: `Worker rejected ${invocation.actionId} manifest identity` }
      }
    }
    try {
      if (signal.aborted || Date.now() >= invocation.deadline) {
        return {
          kind: "defect",
          defect: { name: "DeadlineExceeded", message: `Deadline exceeded before ${invocation.actionId} invocation` }
        }
      }
      const input = assertJson(invocation.input, `${invocation.actionId} input`) as any
      const output = await provider.implementation(input, { invocation, signal })
      return { kind: "success", value: assertJson(output, `${invocation.actionId} success`) }
    } catch (error) {
      if (error instanceof ActionFailure) {
        return { kind: "failure", error: assertJson(error.failure, `${invocation.actionId} failure`) }
      }
      const defect = error instanceof Error
        ? { name: error.name, message: error.message, ...(error.stack === undefined ? {} : { stack: error.stack }) }
        : { name: "ThrownDefect", message: String(error) }
      return { kind: "defect", defect }
    }
  }
}
