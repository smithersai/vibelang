import type { CompiledFlow, DurableAction } from "./authoring.ts"
import { validateDeploymentManifest, validatePlanTemplate } from "./artifact.ts"
import {
  allPlanNodes,
  assertJson,
  canonicalJson,
  decodeCanonicalJson,
  fanOutSteps,
  type ActionRouteManifest,
  type ActionImplementationContract,
  type DeploymentManifest,
  deepFreeze,
  digest,
  encodeCanonicalJson,
  type Invocation,
  type JsonValue,
  type RecoveryPolicy,
  type ReusePolicy,
  type SerializableProviderPolicy,
  type WorkerExit,
  type WorkerPoolManifest
} from "./ir.ts"
import { ActionFailure } from "./authoring.ts"
import { validateDurableValue } from "./schema.ts"
import {
  assertActionImplementationContractMatchesAction,
  requireCompilerAuthenticatedContract,
  requireCompilerAuthenticatedImplementation,
  validateActionImplementationContract
} from "./implementation-contract.ts"
import {
  buildWorkerPoolBundle,
  type WorkerPoolBundle,
  type WorkerPoolBundleSelection
} from "./pool-bundle.ts"

export interface ActionExecutionContext {
  readonly invocation: Invocation
  /** In-process POC cancellation signal; production workers enforce this out of process. */
  readonly signal: AbortSignal
}

/** Coordinator-facing worker contract shared by local and isolated transports. */
export interface DurableWorker {
  invoke(invocation: Invocation, signal?: AbortSignal): Promise<WorkerExit>
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
  /** Legacy providers cannot request authority; use `provideChecked` for capabilities. */
  readonly capabilities?: readonly string[]
  /** "any" permits this implementation in any TypeScript POC pool. */
  readonly target?: string
}

export interface CheckedProviderOptions<Input> extends ProviderOptions<Input> {
  readonly implementationContract: ActionImplementationContract
}

export interface ActionProvider<Input = unknown, Success = unknown, Failure = unknown> {
  readonly action: DurableAction<Input, Success, Failure>
  readonly implementation: ActionImplementation<Input, Success>
  readonly implementationId: string
  readonly implementationVersion: string
  readonly actionContractDigest: string
  readonly implementationContract: ActionImplementationContract | null
  readonly implementationDigest: string
  readonly policyDigest: string
  readonly recovery: RecoveryPolicy
  readonly reuse: ProviderReuse<Input>
  readonly dependencyDigests: readonly string[]
  readonly capabilityGrant: readonly string[]
  readonly target: string
}

const defaultRecovery: RecoveryPolicy = Object.freeze({
  mode: "manual",
  maxAttempts: 1
})

const issuedProviders = new WeakMap<object, { readonly implementationContractDigest: string | null }>()

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
  if (!(["repeatable", "downstream-deduplicated", "manual"] as const).includes(recovery.mode)) {
    throw new TypeError(`Provider for ${actionId} has invalid recovery mode`)
  }
  if (!Number.isSafeInteger(recovery.maxAttempts) || recovery.maxAttempts < 1) {
    throw new TypeError(`Provider for ${actionId} has invalid maxAttempts`)
  }
  if (recovery.retryTypedFailures !== undefined && typeof recovery.retryTypedFailures !== "boolean") {
    throw new TypeError(`Provider for ${actionId} has invalid typed-failure retry policy`)
  }
  if (recovery.delayMs !== undefined && (!Number.isSafeInteger(recovery.delayMs) || recovery.delayMs < 0)) {
    throw new TypeError(`Provider for ${actionId} has invalid retry delay`)
  }
}

const makeProvider = <Input, Success, Failure>(
  action: DurableAction<Input, Success, Failure>,
  implementation: ActionImplementation<Input, Success>,
  options: ProviderOptions<Input>,
  implementationContract: ActionImplementationContract | null
): ActionProvider<Input, Success, Failure> => {
  const implementationId = options.implementationId
  const implementationVersion = options.implementationVersion
  if (
    typeof implementation !== "function" ||
    typeof implementationId !== "string" || implementationId.trim() === "" ||
    typeof implementationVersion !== "string" || implementationVersion.trim() === ""
  ) {
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
  const dependencyDigests = Object.freeze([
    ...new Set([
      ...(options.dependencyDigests ?? []),
      ...(implementationContract === null ? [] : [implementationContract.digest])
    ])
  ].sort())
  const capabilityGrant = Object.freeze([...new Set(options.capabilities ?? [])].sort())
  if (capabilityGrant.some((capability) => typeof capability !== "string" || capability.trim() === "")) {
    throw new TypeError(`Provider for ${action.descriptor.id} has an empty capability identity`)
  }
  const target = options.target ?? "any"
  if (typeof target !== "string" || target.trim() === "") {
    throw new TypeError(`Provider for ${action.descriptor.id} has an invalid target`)
  }
  const implementationDigest = digest({
    implementationId,
    implementationVersion,
    actionId: action.descriptor.id,
    actionVersion: action.descriptor.version,
    actionContractDigest: action.descriptor.contractDigest,
    implementationContractDigest: implementationContract?.digest ?? null,
    dependencyDigests,
    target
  })
  const policyDigest = digest({
    recovery,
    reuse: serializableReuse(reuse as ProviderReuse<unknown>),
    capabilityGrant
  })
  const provider = Object.freeze({
    action,
    implementation,
    implementationId,
    implementationVersion,
    actionContractDigest: action.descriptor.contractDigest,
    implementationContract,
    implementationDigest,
    policyDigest,
    recovery,
    reuse,
    dependencyDigests,
    capabilityGrant,
    target
  })
  issuedProviders.set(provider, { implementationContractDigest: implementationContract?.digest ?? null })
  return provider
}

const provide = <Input, Success, Failure>(
  action: DurableAction<Input, Success, Failure>,
  implementation: ActionImplementation<Input, Success>,
  options: ProviderOptions<Input>
): ActionProvider<Input, Success, Failure> => {
  if ((options.capabilities?.length ?? 0) > 0) {
    throw new TypeError(
      `Legacy provider ${options.implementationId} cannot receive capability authority; use Provider.provideChecked`
    )
  }
  return makeProvider(action, implementation, { ...options, capabilities: [] }, null)
}

/**
 * Local compiler-evidence POC. The compiler freezes the transitive row
 * contract and pairs it with this exact callback in-process; deployment then
 * closes its requirement row exactly. This does NOT attest the callback's
 * lexical closure or an imported/emitted worker bundle. Nonempty authority is
 * not production-safe until the worker loads a digest-pinned emitted module
 * instead of accepting a live host callback.
 */
const provideChecked = <Input, Success, Failure>(
  action: DurableAction<Input, Success, Failure>,
  implementation: ActionImplementation<Input, Success>,
  options: CheckedProviderOptions<Input>
): ActionProvider<Input, Success, Failure> => {
  const implementationContract = requireCompilerAuthenticatedContract(options.implementationContract)
  requireCompilerAuthenticatedImplementation(implementationContract, implementation)
  if (
    implementationContract.implementationId !== options.implementationId ||
    implementationContract.implementationVersion !== options.implementationVersion
  ) {
    throw new TypeError("checked provider identity does not match its compiler-derived implementation contract")
  }
  assertActionImplementationContractMatchesAction(implementationContract, action.descriptor)
  return makeProvider(action, implementation, options, implementationContract)
}

export interface WorkerPool {
  readonly id: string
  readonly target: string
  readonly sandbox: string
  readonly placement: Readonly<Record<string, JsonValue>>
  readonly providers: readonly ActionProvider<any, any, any>[]
  /**
   * When true, `Deployment.build` emits one tree-shaken JavaScript bundle for
   * this pool from the selected providers' checked implementation contracts and
   * pins its SHA-256 into the signed manifest as the pool `bundleDigest`.
   */
  readonly emitBundle: boolean
}

export interface WorkerPoolOptions {
  readonly target: string
  readonly sandbox?: string
  readonly placement?: Readonly<Record<string, unknown>>
  readonly providers: readonly ActionProvider<any, any, any>[]
  readonly bundle?: boolean
}

const pool = (id: string, options: WorkerPoolOptions): WorkerPool => {
  const target = options.target
  const sandbox = options.sandbox ?? "in-process-poc"
  const providers = Object.freeze([...options.providers])
  if (typeof id !== "string" || id.trim() === "") throw new TypeError("Worker pool id must be non-empty")
  if (typeof target !== "string" || target.trim() === "") throw new TypeError(`Worker pool ${id} target must be non-empty`)
  if (typeof sandbox !== "string" || sandbox.trim() === "") throw new TypeError(`Worker pool ${id} sandbox must be non-empty`)
  if (options.bundle !== undefined && typeof options.bundle !== "boolean") {
    throw new TypeError(`Worker pool ${id} bundle option must be boolean`)
  }
  const placement = assertJson(options.placement ?? {}, `Worker pool ${id} placement`)
  if (Array.isArray(placement) || placement === null || typeof placement !== "object") {
    throw new TypeError(`Worker pool ${id} placement must be an object`)
  }
  return Object.freeze({
    id,
    target,
    sandbox,
    placement: deepFreeze(placement),
    providers,
    emitBundle: options.bundle ?? false
  })
}

export interface BuiltDeployment<Input = unknown, Success = unknown> {
  readonly flow: CompiledFlow<Input, Success>
  readonly manifest: DeploymentManifest
  /** Runtime code is intentionally outside the serializable coordinator manifest. */
  readonly providers: ReadonlyMap<string, ActionProvider<any, any, any>>
  readonly pools: ReadonlyMap<string, WorkerPool>
  /**
   * Tree-shaken worker bundles keyed by pool id, present exactly for pools
   * built with `bundle: true`. Each bundle's SHA-256 equals the corresponding
   * manifest pool `bundleDigest`, which the Ed25519 envelope signs.
   */
  readonly bundles: ReadonlyMap<string, WorkerPoolBundle>
  /**
   * Complete deployments for every Plan embedded by a childFlow node, keyed by
   * child Plan digest. Each child execution is pinned to its own plan and
   * manifest; the same worker pools are reused with per-child tree-shaking.
   */
  readonly childDeployments: ReadonlyMap<string, BuiltDeployment<unknown, unknown>>
}

const issuedDeployments = new WeakSet<object>()

/** @internal Signature authentication must not bless structural lookalikes. */
export const requireLocallyBuiltDeployment = <Input, Success>(
  deployment: BuiltDeployment<Input, Success>
): BuiltDeployment<Input, Success> => {
  if (deployment === null || typeof deployment !== "object" || !issuedDeployments.has(deployment)) {
    throw new TypeError("runtime deployment was not issued by Deployment.build")
  }
  return deployment
}

class ImmutableMap<Key, Value> implements ReadonlyMap<Key, Value> {
  readonly #values: Map<Key, Value>
  constructor(values: Iterable<readonly [Key, Value]>) { this.#values = new Map(values) }
  get size(): number { return this.#values.size }
  get(key: Key): Value | undefined { return this.#values.get(key) }
  has(key: Key): boolean { return this.#values.has(key) }
  entries(): MapIterator<[Key, Value]> { return this.#values.entries() }
  keys(): MapIterator<Key> { return this.#values.keys() }
  values(): MapIterator<Value> { return this.#values.values() }
  forEach(callbackfn: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.#values) callbackfn.call(thisArg, value, key, this)
  }
  [Symbol.iterator](): MapIterator<[Key, Value]> { return this.#values[Symbol.iterator]() }
}

const policyFor = (provider: ActionProvider<any, any, any>, pool: WorkerPool): SerializableProviderPolicy => ({
  recovery: provider.recovery,
  reuse: serializableReuse(provider.reuse as ProviderReuse<unknown>),
  dependencyDigests: provider.dependencyDigests,
  capabilityGrant: provider.capabilityGrant,
  target: pool.target
})

const compareCanonicalStrings = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

const buildDeployment = <Input, Success>(options: {
  readonly id: string
  readonly flow: CompiledFlow<Input, Success>
  readonly pools: readonly WorkerPool[]
}): BuiltDeployment<Input, Success> => {
  const deploymentId = options.id
  const sourceFlow = options.flow
  const workerPools = Object.freeze([...options.pools])
  if (typeof deploymentId !== "string" || deploymentId.trim() === "") {
    throw new TypeError("Deployment id must be non-empty")
  }
  // The authoring POC temporarily needs nominal descriptor identity because its
  // schema bodies are generic stubs. Capture it before artifact validation
  // produces a detached canonical snapshot.
  const artifactSource = sourceFlow.artifactSource
  const nominalDescriptors = artifactSource === "static-plan-artifact"
    ? undefined
    : new Map(sourceFlow.plan.actions.map((action) => [action.id, action]))
  const plan = validatePlanTemplate(sourceFlow.plan)
  const flow: CompiledFlow<Input, Success> = Object.freeze({
    id: plan.flowId,
    version: plan.flowVersion,
    plan,
    ...(artifactSource === undefined ? {} : { artifactSource })
  })
  const plannedActions = new Map(plan.actions.map((action) => [action.id, action]))
  for (const node of allPlanNodes(plan)) {
    const references = node.kind === "action" || node.kind === "loop"
      ? [{ actionId: node.actionId, actionVersion: node.actionVersion, actionContractDigest: node.actionContractDigest }]
      : node.kind === "fanout"
        ? fanOutSteps(node)
        : []
    for (const reference of references) {
      const descriptor = plannedActions.get(reference.actionId)
      if (
        descriptor === undefined ||
        reference.actionVersion !== descriptor.version ||
        reference.actionContractDigest !== descriptor.contractDigest
      ) {
        throw new Error(`Plan node ${node.id} has an Action version/schema contract mismatch for ${reference.actionId}`)
      }
    }
  }
  const poolsById = new Map<string, WorkerPool>()
  const candidates = new Map<string, { provider: ActionProvider<any, any, any>; pool: WorkerPool }>()
  for (const workerPool of workerPools) {
    if (poolsById.has(workerPool.id)) throw new Error(`Duplicate worker pool ${workerPool.id}`)
    poolsById.set(workerPool.id, workerPool)
    for (const provider of workerPool.providers) {
      const issued = issuedProviders.get(provider)
      if (
        issued === undefined ||
        issued.implementationContractDigest !== (provider.implementationContract?.digest ?? null)
      ) {
        throw new Error("Deployment rejected an unauthenticated or mutated Action provider")
      }
      const actionId = provider.action.descriptor.id
      if (!plan.requirements.includes(actionId)) continue // tree shake unused implementations
      const plannedDescriptor = plan.actions.find((action) => action.id === actionId)
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
      if (nominalDescriptors !== undefined && nominalDescriptors.get(actionId) !== provider.action.descriptor) {
        throw new Error(
          `Provider ${provider.implementationId} uses a different nominal descriptor for ${actionId}`
        )
      }
      if (provider.target !== "any" && provider.target !== workerPool.target) {
        throw new Error(
          `Provider ${provider.implementationId} targets ${provider.target}, incompatible with pool ${workerPool.id} (${workerPool.target})`
        )
      }
      if (provider.implementationContract === null) {
        if (provider.capabilityGrant.length > 0) {
          throw new Error(`Legacy provider ${provider.implementationId} cannot receive capability authority`)
        }
      } else {
        const contract = validateActionImplementationContract(provider.implementationContract)
        assertActionImplementationContractMatchesAction(contract, provider.action.descriptor)
        if (
          contract.implementationId !== provider.implementationId ||
          contract.implementationVersion !== provider.implementationVersion ||
          !provider.dependencyDigests.includes(contract.digest) ||
          canonicalJson(contract.requirements) !== canonicalJson(provider.capabilityGrant)
        ) {
          throw new Error(`Provider ${provider.implementationId} does not close its compiler-derived requirements`)
        }
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
  for (const required of plan.requirements) {
    if (!candidates.has(required)) {
      throw new Error(`Deployment ${deploymentId} is missing provider required by Flow: ${required}`)
    }
  }

  // A pool built with `bundle: true` emits one tree-shaken JavaScript bundle
  // from the exact checked source projects its selected providers' compiler
  // contracts pin. The bundle's SHA-256 joins the pool artifact digest and the
  // manifest, so the deployment signature covers the worker bundle bytes.
  const bundleByPool = new Map<string, WorkerPoolBundle>()
  for (const workerPool of workerPools) {
    if (!workerPool.emitBundle) continue
    const selections: WorkerPoolBundleSelection[] = []
    for (const [actionId, candidate] of candidates.entries()) {
      if (candidate.pool.id !== workerPool.id) continue
      if (candidate.provider.implementationContract === null) {
        throw new Error(
          `Pool ${workerPool.id} cannot emit a bundle: provider ${candidate.provider.implementationId} ` +
          `for ${actionId} has no checked implementation contract`
        )
      }
      selections.push({
        action: candidate.provider.action.descriptor,
        contract: candidate.provider.implementationContract
      })
    }
    bundleByPool.set(workerPool.id, buildWorkerPoolBundle({
      poolId: workerPool.id,
      target: workerPool.target,
      sandbox: workerPool.sandbox,
      selections
    }))
  }

  const artifactByPool = new Map<string, string>()
  for (const workerPool of workerPools) {
    const selected = [...candidates.entries()]
      .filter(([, candidate]) => candidate.pool.id === workerPool.id)
      .map(([actionId, candidate]) => ({
        actionId,
        implementationDigest: candidate.provider.implementationDigest,
        policyDigest: candidate.provider.policyDigest
      }))
      .sort((left, right) => compareCanonicalStrings(left.actionId, right.actionId))
    const poolBundle = bundleByPool.get(workerPool.id)
    artifactByPool.set(
      workerPool.id,
      digest({
        poolId: workerPool.id,
        target: workerPool.target,
        sandbox: workerPool.sandbox,
        selected,
        ...(poolBundle === undefined ? {} : { bundleDigest: poolBundle.digest })
      })
    )
  }

  const poolManifests: WorkerPoolManifest[] = [...workerPools]
    .sort((left, right) => compareCanonicalStrings(left.id, right.id))
    .map((workerPool) => ({
    id: workerPool.id,
    target: workerPool.target,
    sandbox: workerPool.sandbox,
    placement: workerPool.placement,
    artifactDigest: artifactByPool.get(workerPool.id)!,
    actionIds: [...candidates.entries()]
      .filter(([, candidate]) => candidate.pool.id === workerPool.id)
      .map(([actionId]) => actionId)
      .sort(),
    ...(bundleByPool.has(workerPool.id) ? { bundleDigest: bundleByPool.get(workerPool.id)!.digest } : {})
    }))
  const routes: ActionRouteManifest[] = [...candidates.entries()]
    .sort(([left], [right]) => compareCanonicalStrings(left, right))
    .map(([actionId, candidate]) => ({
      actionId,
      actionVersion: candidate.provider.action.descriptor.version,
      actionContractDigest: candidate.provider.actionContractDigest,
      poolId: candidate.pool.id,
      artifactDigest: artifactByPool.get(candidate.pool.id)!,
      implementationDigest: candidate.provider.implementationDigest,
      implementationContract: candidate.provider.implementationContract,
      policyDigest: candidate.provider.policyDigest,
      policy: policyFor(candidate.provider, candidate.pool),
      schemas: {
        input: candidate.provider.action.descriptor.inputSchema,
        success: candidate.provider.action.descriptor.successSchema,
        error: candidate.provider.action.descriptor.errorSchema
      }
    }))
  const coordinatorDigest = digest({
    planDigest: plan.digest,
    routes: routes.map(({ actionId, poolId, implementationDigest, policyDigest }) => ({
      actionId,
      poolId,
      implementationDigest,
      policyDigest
    }))
  })
  const unsigned = {
    formatVersion: 1 as const,
    deploymentId,
    planDigest: plan.digest,
    coordinatorDigest,
    pools: poolManifests,
    routes
  }
  const manifest: DeploymentManifest = validateDeploymentManifest(
    deepFreeze({ ...unsigned, digest: digest(unsigned) }),
    plan
  )
  // Every embedded child Plan becomes its own complete pinned deployment: own
  // manifest, own coordinator digest, per-child tree-shaken provider table.
  // Recursion covers grandchildren because a child Plan embeds its own
  // children; plan validation already bounds the embedding depth.
  const childDeployments = new Map<string, BuiltDeployment<unknown, unknown>>()
  for (const childPlan of plan.childFlows ?? []) {
    const childFlow: CompiledFlow<unknown, unknown> = Object.freeze({
      id: childPlan.flowId,
      version: childPlan.flowVersion,
      plan: childPlan,
      artifactSource: "static-plan-artifact" as const
    })
    childDeployments.set(childPlan.digest, buildDeployment({
      id: `${deploymentId}/child/${childPlan.digest.slice(0, 16)}`,
      flow: childFlow,
      pools: workerPools
    }))
  }
  const deployment = Object.freeze({
    flow,
    manifest,
    providers: new ImmutableMap([...candidates].map(([actionId, candidate]) => [actionId, candidate.provider] as const)),
    pools: new ImmutableMap(poolsById),
    bundles: new ImmutableMap(bundleByPool),
    childDeployments: new ImmutableMap(childDeployments)
  })
  issuedDeployments.add(deployment)
  return deployment
}

/**
 * Every bundle reachable from a deployment, keyed by content digest. Child
 * deployments are tree-shaken per child Plan, so the same pool can carry a
 * different (smaller) bundle inside a child; worker factories look bundles up
 * by the manifest's pool `bundleDigest`, which is exact for parent and child.
 */
export const collectPoolBundles = (
  deployment: BuiltDeployment<any, any>
): ReadonlyMap<string, WorkerPoolBundle> => {
  const found = new Map<string, WorkerPoolBundle>()
  const visit = (current: BuiltDeployment<any, any>): void => {
    for (const bundle of current.bundles.values()) found.set(bundle.digest, bundle)
    for (const child of current.childDeployments.values()) visit(child)
  }
  visit(requireLocallyBuiltDeployment(deployment))
  return found
}

export const Provider = { provide, provideChecked } as const
export const Worker = { pool } as const
export const Deployment = { build: buildDeployment } as const

const hasExactKeys = (value: unknown, expected: readonly string[]): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" && !Array.isArray(value) &&
  canonicalJson(Object.keys(value).sort()) === canonicalJson([...expected].sort())

const thrownDefect = (error: unknown): WorkerExit => {
  try {
    const candidate = error instanceof Error
      ? { name: error.name, message: error.message, ...(error.stack === undefined ? {} : { stack: error.stack }) }
      : { name: "ThrownDefect", message: String(error) }
    const encoded = assertJson(candidate, "Action defect")
    if (
      encoded !== null && typeof encoded === "object" && !Array.isArray(encoded) &&
      typeof encoded.name === "string" && typeof encoded.message === "string" &&
      (encoded.stack === undefined || typeof encoded.stack === "string")
    ) {
      return { kind: "defect", defect: encoded as { readonly name: string; readonly message: string; readonly stack?: string } }
    }
  } catch {
    // A hostile thrown value can itself have throwing accessors/toString.
  }
  return {
    kind: "defect",
    defect: { name: "DefectCodecDefect", message: "Thrown value could not be encoded by the durable defect codec" }
  }
}

/**
 * A structured-clone-shaped worker boundary. It verifies the exact artifact,
 * route, implementation digest and action version before invoking ordinary code.
 */
export type PreparedWorkerInvocation =
  | {
    readonly ready: true
    readonly invocation: Invocation
    readonly input: JsonValue
    readonly route: ActionRouteManifest
    readonly provider: ActionProvider<any, any, any>
  }
  | { readonly ready: false; readonly exit: WorkerExit }

/** The manifest-only half of the worker gate, usable without live providers. */
export type PreparedManifestInvocation =
  | {
    readonly ready: true
    readonly invocation: Invocation
    readonly input: JsonValue
    readonly route: ActionRouteManifest
  }
  | { readonly ready: false; readonly exit: WorkerExit }

/**
 * Everything a worker process needs to authenticate an invocation against the
 * signed manifest when the live provider table is deliberately absent (remote
 * worker hosts execute digest-pinned bundles, never host callbacks).
 */
export interface ManifestWorkerGate {
  readonly poolId: string
  readonly poolTarget: string
  readonly artifactDigest: string
  readonly actionTable: readonly string[]
  readonly routes: readonly ActionRouteManifest[]
}

export const manifestWorkerGate = (manifest: DeploymentManifest, poolId: string): ManifestWorkerGate => {
  const poolManifest = manifest.pools.find((candidate) => candidate.id === poolId)
  if (poolManifest === undefined) throw new Error(`Pool ${poolId} absent from deployment manifest`)
  return Object.freeze({
    poolId: poolManifest.id,
    poolTarget: poolManifest.target,
    artifactDigest: poolManifest.artifactDigest,
    actionTable: poolManifest.actionIds,
    routes: manifest.routes
  })
}

/**
 * Decode and authenticate the complete invocation envelope before any Action
 * code can run: exact wire fields, route identity against the manifest,
 * capability grant, input codec, cancellation, deadline, and lease. Local,
 * isolated, and remote transports all pass through this exact gate, so
 * transport choice cannot silently weaken invocation validation. The optional
 * `verify` hook lets the in-process worker add provider-table checks between
 * route verification and the input codec without reordering any check.
 */
export const prepareManifestInvocation = (
  gate: ManifestWorkerGate,
  rawInvocation: Invocation,
  signal: AbortSignal = new AbortController().signal,
  verify?: (invocation: Invocation, route: ActionRouteManifest) => boolean
): PreparedManifestInvocation => {
  // The worker gate uses the exact canonical wire codec used by persisted artifacts.
  let invocation: Invocation
  try {
    invocation = decodeCanonicalJson(encodeCanonicalJson(rawInvocation), "Action invocation") as unknown as Invocation
    if (
      !hasExactKeys(invocation, [
        "schemaVersion", "executionId", "nodeId", "attempt", "actionId", "actionVersion",
        "actionContractDigest", "implementationDigest", "input", "deadline",
        "downstreamIdempotencyKey", "capabilityGrant", "lease", "budget", "fencingToken", "traceContext"
      ]) ||
      invocation.schemaVersion !== 1 ||
      invocation.executionId.trim() === "" ||
      invocation.nodeId.trim() === "" ||
      invocation.actionId.trim() === "" ||
      !Number.isSafeInteger(invocation.attempt) || invocation.attempt < 1 ||
      !Number.isSafeInteger(invocation.actionVersion) || invocation.actionVersion < 1 ||
      !Number.isSafeInteger(invocation.deadline) || invocation.deadline < 0 ||
      !Number.isSafeInteger(invocation.fencingToken) || invocation.fencingToken < 1 ||
      !hasExactKeys(invocation.lease, ["owner", "expiresAt"]) ||
      !Number.isSafeInteger(invocation.lease.expiresAt) || invocation.lease.expiresAt < 0 ||
      typeof invocation.lease.owner !== "string" || invocation.lease.owner.trim() === "" ||
      !hasExactKeys(invocation.budget, ["expiresAt"]) ||
      !Number.isSafeInteger(invocation.budget.expiresAt) || invocation.budget.expiresAt < 0 ||
      invocation.budget.expiresAt > invocation.deadline ||
      !Array.isArray(invocation.capabilityGrant) ||
      invocation.capabilityGrant.some((item) => typeof item !== "string" || item.trim() === "") ||
      canonicalJson(invocation.capabilityGrant) !== canonicalJson([...new Set(invocation.capabilityGrant)].sort()) ||
      !/^[0-9a-f]{64}$/.test(invocation.actionContractDigest) ||
      !/^[0-9a-f]{64}$/.test(invocation.implementationDigest) ||
      !/^[0-9a-f]{64}$/.test(invocation.downstreamIdempotencyKey) ||
      invocation.traceContext === null || typeof invocation.traceContext !== "object" ||
      Array.isArray(invocation.traceContext) || Object.values(invocation.traceContext).some((item) => typeof item !== "string")
    ) {
      throw new TypeError("invalid invocation fields")
    }
  } catch (error) {
    return { ready: false, exit: {
      kind: "defect",
      defect: { name: "InvocationCodecDefect", message: error instanceof Error ? error.message : String(error) }
    } }
  }
  const route = gate.routes.find((candidate) => candidate.actionId === invocation.actionId)
  if (route === undefined || route.poolId !== gate.poolId) {
    return { ready: false, exit: {
      kind: "defect",
      defect: { name: "RoutingDefect", message: `No route for ${invocation.actionId}` }
    } }
  }
  if (
    !gate.actionTable.includes(invocation.actionId) ||
    route.artifactDigest !== gate.artifactDigest ||
    route.actionVersion !== invocation.actionVersion ||
    route.actionContractDigest !== invocation.actionContractDigest ||
    route.implementationDigest !== invocation.implementationDigest ||
    route.policy.target !== gate.poolTarget ||
    canonicalJson(route.policy.capabilityGrant) !== canonicalJson(invocation.capabilityGrant) ||
    (verify !== undefined && !verify(invocation, route))
  ) {
    return { ready: false, exit: {
      kind: "defect",
      defect: { name: "ManifestVerificationDefect", message: `Worker rejected ${invocation.actionId} manifest identity` }
    } }
  }
  let input: JsonValue
  try {
    input = validateDurableValue(route.schemas.input, invocation.input, `${invocation.actionId} input`)
  } catch (error) {
    return { ready: false, exit: {
      kind: "defect",
      defect: {
        name: "InvocationCodecDefect",
        message: error instanceof Error ? error.message : `${invocation.actionId} input failed its durable codec`
      }
    } }
  }
  if (signal.aborted) {
    return { ready: false, exit: {
      kind: "defect",
      defect: { name: "InvocationCancelled", message: `${invocation.actionId} invocation was cancelled before start` }
    } }
  }
  const now = Date.now()
  if (now >= invocation.deadline) {
    return { ready: false, exit: {
      kind: "defect",
      defect: { name: "DeadlineExceeded", message: `Deadline exceeded before ${invocation.actionId} invocation` }
    } }
  }
  // Deliberately NOT `invocation.lease.expiresAt`: that snapshot is stale the
  // moment the coordinator's first heartbeat renews the store lease, so gating
  // on it rejects perfectly live long-running Actions on exactly the transports
  // that happen to look at it. `budget` is the coordinator's live horizon.
  if (now >= invocation.budget.expiresAt) {
    return { ready: false, exit: {
      kind: "defect",
      defect: {
        name: "InvocationBudgetExpired",
        message: `Execution budget expired before ${invocation.actionId} invocation`
      }
    } }
  }
  return { ready: true, invocation, input, route }
}

/**
 * The single execution-budget derivation every worker transport shares.
 *
 * The coordinator owns the horizon (`Invocation.budget`) because it is the only
 * party that knows the lease it is actively renewing. A transport re-deriving a
 * budget from `invocation.lease.expiresAt` would be reading a claim-time
 * snapshot that goes stale after `leaseMs/3`, which is precisely how the same
 * deployment came to succeed in-process and time out over HTTP.
 *
 * `graceMs` is the only per-transport freedom: a layer that waits on another
 * layer's answer (the remote client waiting on the worker host) allows itself a
 * little more than the horizon so the inner layer's own verdict wins the race
 * rather than being cut off mid-wire.
 */
export const invocationBudgetMs = (
  invocation: Invocation,
  graceMs = 0,
  now = Date.now()
): number => invocation.budget.expiresAt - now + graceMs

/**
 * Default transport grace. The coordinator runs its OWN race against the same
 * horizon (`DurableExecutor` deadline/cancellation), and its verdict is the
 * authoritative one, so a transport must not preempt it by a millisecond of
 * timer jitter. The remote client allows itself more still (`INVOKE_GRACE_MS`)
 * so the worker host's verdict arrives over the wire rather than being severed.
 */
export const WORKER_BUDGET_GRACE_MS = 250

/** Host `setTimeout` delays are 32-bit; a longer budget must be re-armed, not clamped. */
const MAX_TIMER_DELAY_MS = 2_147_483_647

export const invocationBudgetExhausted = (invocation: Invocation, label: string): WorkerExit => ({
  kind: "defect",
  defect: {
    name: "InvocationBudgetExceeded",
    message: `${invocation.actionId} exceeded its coordinator execution budget on the ${label} transport`
  }
})

/**
 * Run one attempt under the coordinator's budget and ABORT it when the budget
 * wins. Every transport funnels through here, so "the budget elapsed" always
 * means the work was cancelled, never merely abandoned while it keeps running
 * and the coordinator retries it somewhere else.
 *
 * The derived signal is aborted on every exit path, not just the timeout, so a
 * finished attempt can never leave work it started still running.
 */
export const withInvocationBudget = async (
  invocation: Invocation,
  options: {
    /** Names this transport in the budget defect. */
    readonly label: string
    /** Caller cancellation, forwarded into `run`. */
    readonly signal?: AbortSignal
    readonly graceMs?: number
  },
  run: (signal: AbortSignal) => Promise<WorkerExit>
): Promise<WorkerExit> => {
  const budgetMs = invocationBudgetMs(invocation, options.graceMs ?? 0)
  if (budgetMs <= 0) return invocationBudgetExhausted(invocation, options.label)
  const controller = new AbortController()
  const caller = options.signal
  const forward = (): void => controller.abort(caller?.reason)
  if (caller !== undefined) {
    if (caller.aborted) forward()
    else caller.addEventListener("abort", forward, { once: true })
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const exhausted = new Promise<WorkerExit>((resolve) => {
    // Re-armed rather than a single sleep: a far-future persisted deadline
    // exceeds the host timer's 32-bit delay and would otherwise be clamped into
    // firing immediately, cancelling work that has hours of budget left.
    const schedule = (): void => {
      const remaining = invocationBudgetMs(invocation, options.graceMs ?? 0)
      if (remaining > 0) {
        timer = setTimeout(schedule, Math.min(MAX_TIMER_DELAY_MS, remaining))
        timer.unref?.()
        return
      }
      // Abort BEFORE resolving: the work must be cancelled by the time the
      // caller is told the budget elapsed, not after it has already retried.
      controller.abort(new Error(`${invocation.actionId} exceeded its execution budget`))
      resolve(invocationBudgetExhausted(invocation, options.label))
    }
    schedule()
  })
  try {
    return await Promise.race([run(controller.signal), exhausted])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    caller?.removeEventListener("abort", forward)
    controller.abort()
  }
}

export class LocalWorker implements DurableWorker {
  readonly artifactDigest: string
  readonly actionTable: readonly string[]
  readonly #gate: ManifestWorkerGate

  constructor(
    readonly pool: WorkerPool,
    readonly manifest: DeploymentManifest,
    readonly providers: ReadonlyMap<string, ActionProvider<any, any, any>>
  ) {
    const poolManifest = manifest.pools.find((candidate) => candidate.id === pool.id)
    if (poolManifest === undefined) throw new Error(`Pool ${pool.id} absent from deployment manifest`)
    if (
      poolManifest.target !== pool.target ||
      poolManifest.sandbox !== pool.sandbox ||
      canonicalJson(poolManifest.placement) !== canonicalJson(pool.placement)
    ) {
      throw new Error(`Pool ${pool.id} runtime configuration does not match its deployment manifest`)
    }
    this.artifactDigest = poolManifest.artifactDigest
    this.actionTable = poolManifest.actionIds
    this.#gate = manifestWorkerGate(manifest, pool.id)
  }

  /**
   * Decode and authenticate the complete invocation before any provider code
   * runs. Isolated transports reuse this gate so transport choice cannot
   * silently weaken the manifest, capability, lease, or input-codec checks.
   */
  prepare(
    rawInvocation: Invocation,
    signal: AbortSignal = new AbortController().signal
  ): PreparedWorkerInvocation {
    let provider: ActionProvider<any, any, any> | undefined
    const prepared = prepareManifestInvocation(this.#gate, rawInvocation, signal, (invocation, route) => {
      provider = this.providers.get(invocation.actionId)
      return (
        provider !== undefined &&
        issuedProviders.get(provider)?.implementationContractDigest ===
          (provider.implementationContract?.digest ?? null) &&
        canonicalJson(route.implementationContract) === canonicalJson(provider.implementationContract) &&
        route.policyDigest === provider.policyDigest &&
        canonicalJson(route.policy.recovery) === canonicalJson(provider.recovery) &&
        canonicalJson(route.policy.reuse) === canonicalJson(serializableReuse(provider.reuse as ProviderReuse<unknown>)) &&
        canonicalJson(route.policy.dependencyDigests) === canonicalJson(provider.dependencyDigests) &&
        (provider.target === "any" || provider.target === route.policy.target) &&
        canonicalJson(provider.capabilityGrant) === canonicalJson(invocation.capabilityGrant) &&
        provider.implementationDigest === invocation.implementationDigest &&
        provider.action.descriptor.id === invocation.actionId &&
        provider.action.descriptor.version === invocation.actionVersion &&
        provider.actionContractDigest === invocation.actionContractDigest &&
        provider.action.descriptor.contractDigest === invocation.actionContractDigest
      )
    })
    if (!prepared.ready) return prepared
    if (provider === undefined) {
      return { ready: false, exit: {
        kind: "defect",
        defect: { name: "ManifestVerificationDefect", message: `Worker rejected ${prepared.invocation.actionId} manifest identity` }
      } }
    }
    return { ...prepared, provider }
  }

  async invoke(rawInvocation: Invocation, signal: AbortSignal = new AbortController().signal): Promise<WorkerExit> {
    const prepared = this.prepare(rawInvocation, signal)
    if (!prepared.ready) return prepared.exit
    const { invocation, input, provider, route } = prepared
    // In-process work is only cooperatively cancellable, but the budget is the
    // same budget every other transport enforces, and the implementation is
    // handed the derived signal so it can stop.
    return withInvocationBudget(
      invocation,
      { label: "in-process", signal, graceMs: WORKER_BUDGET_GRACE_MS },
      async (budgetSignal) => {
      try {
        const output = await provider.implementation(input as any, {
          invocation,
          signal: budgetSignal
        })
        try {
          return {
            kind: "success",
            value: validateDurableValue(route.schemas.success, output, `${invocation.actionId} success`)
          }
        } catch (error) {
          return {
            kind: "defect",
            defect: {
              name: "SuccessCodecDefect",
              message: error instanceof Error ? error.message : `${invocation.actionId} success failed its durable codec`
            }
          }
        }
      } catch (error) {
        if (error instanceof ActionFailure) {
          try {
            return {
              kind: "failure",
              error: validateDurableValue(route.schemas.error, error.failure, `${invocation.actionId} failure`)
            }
          } catch {
            return {
              kind: "defect",
              defect: { name: "FailureCodecDefect", message: `${invocation.actionId} produced a non-durable typed failure` }
            }
          }
        }
        return thrownDefect(error)
      }
    })
  }
}
