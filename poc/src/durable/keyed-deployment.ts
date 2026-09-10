/**
 * Static source deployments for the native keyed Plan profile. Signing binds
 * code and runtime bytes; each invocation is compiled later for the input and
 * Plan id assigned by Control. Neither proof is an approval or a run lease.
 */
import { posix } from "node:path"
import { DenoSubprocessSandbox, type DenoSubprocessSandboxOptions } from "../agent/sandbox.ts"
import type { ComponentIdentity } from "../agent/types.ts"
import { getNativeCompiler, type NativeCompilerIdentity } from "../compiler/native.ts"
import type { NativeKeyedSourceRequest } from "../compiler/protocol.ts"
import { KeyedSourceInterpreter } from "./keyed-interpreter.ts"
import { snapshotKeyedJSON } from "./keyed-value.ts"
import { validateActionContractDescriptor } from "./schema-runtime.ts"
import { validateActionImplementationContract, assertActionImplementationContractMatchesAction } from "./implementation-validation.ts"
import { keyedBundleInvocationDriver, requireCheckedKeyedWorkerPoolBundle, sha256Utf8,
  validateWorkerPoolBundle, type WorkerPoolBundle } from "./pool-bundle.ts"
import { decodeSignedKeyedSourceEnvelope, encodeSignedKeyedSourceEnvelope,
  type DeploymentSigningKeyPair, type TrustedDeploymentKey } from "./signed-deployment.ts"
import { canonicalJson, deepFreeze, digest, type ActionDescriptor, type ActionImplementationContract, type JsonValue } from "./value.ts"

const ABI = "vibelang/keyed-source/v2" as const
const EMPTY_EFFECTS = {boundaryMode: "hard", reads: [], writes: []} as const
const runtimeBrand: unique symbol = Symbol("vibelang.keyed-runtime")
const sourceBrand: unique symbol = Symbol("vibelang.authenticated-keyed-source")
const invocationBrand: unique symbol = Symbol("vibelang.authenticated-keyed-invocation")
type Row = Record<string, unknown>

export class KeyedDeploymentError extends TypeError {
  constructor(message: string) { super(message); this.name = "KeyedDeploymentError" }
}
function fail(message: string): never { throw new KeyedDeploymentError(message) }
const object = (value: unknown, label: string): Row => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(`${label} must be an object`)
  return value as Row
}
const exact = (value: Row, fields: readonly string[], label: string): void => {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...fields].sort())) fail(`${label} has missing or unknown fields`)
}
const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "" || value.includes("\0") || value.length > 16_384) return fail(`${label} must be bounded nonempty text`)
  return value
}

export interface KeyedSourceDeclaration {
  readonly source: string
  readonly fileName: string
  readonly exportName?: string
  /** Explicit identity; independent of a later Control-assigned Plan id. */
  readonly flowId: string
  readonly flowVersion: number
  /** Complete explicit declaration-source closure; never loaded from disk. */
  readonly dependencies?: readonly {readonly fileName: string; readonly source: string}[]
}

/** Explicit policy, never inferred from an abstract Action or provider body. */
export interface KeyedProviderPolicy {
  readonly actionId: string
  readonly tier: "sealed" | "compensable" | "irreversible"
  readonly effects: JsonValue
  readonly layers: readonly string[]
  readonly capabilities: readonly string[]
}

export interface KeyedDeployedProvider extends KeyedProviderPolicy {
  readonly action: ActionDescriptor
  readonly implementation: ActionImplementationContract
  readonly bundleDigest: string
}

/** Data-only build output. A copy can be inspected but cannot be signed here. */
export interface KeyedSourceDeployment {
  readonly deploymentVersion: 1
  readonly abi: typeof ABI
  readonly source: KeyedSourceDeclaration
  readonly compiler: NativeCompilerIdentity
  readonly runtime: ComponentIdentity
  readonly driverDigest: string
  readonly providers: readonly KeyedDeployedProvider[]
  readonly bundles: readonly WorkerPoolBundle[]
  /** Static code/runtime identity; does not include a per-invocation Plan id. */
  readonly executionDigest: string
}

/** Exact local runtime issuance. It conveys no host functions or approval. */
export interface KeyedWorkerRuntime {
  readonly [runtimeBrand]: true
  readonly identity: ComponentIdentity
}
interface LocalRuntime {
  readonly identity: ComponentIdentity
  readonly kind: DenoSubprocessSandbox["kind"]
  readonly execute: DenoSubprocessSandbox["execute"]
}
const runtimes = new WeakMap<object, LocalRuntime>()

export const createKeyedWorkerRuntime = (
  options: Omit<DenoSubprocessSandboxOptions, "runtimeValueInspection"> = {},
): KeyedWorkerRuntime => {
  const safe = object(snapshotKeyedJSON(options), "keyed runtime options")
  const allowed = new Set(["denoPath", "runnerPath", "timeoutMs", "memoryMb", "maxSourceBytes", "maxOutputBytes", "maxCalls", "maxConcurrentCalls"])
  if (Object.keys(safe).some(key => !allowed.has(key))) fail("keyed runtime has unknown or authority-changing options")
  const sandbox = new DenoSubprocessSandbox({maxSourceBytes: 8 * 1024 * 1024, maxOutputBytes: 8 * 1024 * 1024,
    ...safe as DenoSubprocessSandboxOptions, runtimeValueInspection: true})
  Object.freeze(sandbox)
  const runtime = Object.freeze({[runtimeBrand]: true as const, identity: sandbox.identity})
  runtimes.set(runtime, Object.freeze({identity: sandbox.identity, kind: sandbox.kind, execute: sandbox.execute.bind(sandbox)}))
  return runtime
}

/** @internal Resolve issuance without reading properties on an untrusted proof. */
export const requireKeyedWorkerRuntime = (value: KeyedWorkerRuntime): LocalRuntime => {
  if (value === null || typeof value !== "object") return fail("keyed runtime was not issued locally")
  return runtimes.get(value) ?? fail("keyed runtime was not issued locally")
}

const sourceDeclaration = (raw: unknown): KeyedSourceDeclaration => {
  const source = object(raw, "keyed source")
  exact(source, ["source", "fileName", "flowId", "flowVersion", ...(Object.hasOwn(source, "dependencies") ? ["dependencies"] : []),
    ...(Object.hasOwn(source, "exportName") ? ["exportName"] : [])], "keyed source")
  if (typeof source.source !== "string" || Buffer.byteLength(source.source, "utf8") > 2 * 1024 * 1024) fail("keyed source exceeds its source budget")
  const sourcePath = (raw: unknown): string => {
    const fileName = text(raw, "keyed source fileName")
    if (!fileName.endsWith(".vibe") || posix.isAbsolute(fileName) || posix.normalize(fileName) !== fileName ||
      fileName.startsWith("../") || fileName.includes("\\")) fail("keyed source requires a canonical relative .vibe path")
    return fileName
  }
  const fileName = sourcePath(source.fileName)
  const exportName = Object.hasOwn(source, "exportName") ? text(source.exportName, "keyed source exportName") : undefined
  text(source.flowId, "keyed source flowId")
  if (!Number.isSafeInteger(source.flowVersion) || (source.flowVersion as number) < 1) fail("keyed source flowVersion must be a positive safe integer")
  const dependencies: {fileName: string; source: string}[] = []
  if (Object.hasOwn(source, "dependencies")) {
    if (!Array.isArray(source.dependencies) || source.dependencies.length > 256) fail("keyed source requires at most 256 explicit dependency modules")
    const seen = new Set([fileName])
    let bytes = Buffer.byteLength(source.source, "utf8")
    for (const raw of source.dependencies) {
      const dependency = object(raw, "keyed source dependency")
      exact(dependency, ["fileName", "source"], "keyed source dependency")
      const name = sourcePath(dependency.fileName)
      if (seen.has(name) || typeof dependency.source !== "string") fail("keyed source dependency is duplicated or missing its source")
      seen.add(name)
      bytes += Buffer.byteLength(dependency.source, "utf8")
      if (bytes > 2 * 1024 * 1024) fail("keyed source modules exceed their aggregate source budget")
      dependencies.push({fileName: name, source: dependency.source})
    }
    dependencies.sort((a,b) => a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0)
  }
  return {source: source.source, fileName, flowId: source.flowId as string, flowVersion: source.flowVersion as number,
    ...(dependencies.length === 0 ? {} : {dependencies}), ...(exportName === undefined ? {} : {exportName})}
}

const providerPolicy = (raw: unknown): KeyedProviderPolicy => {
  const policy = object(raw, "keyed provider policy")
  exact(policy, ["actionId", "tier", "effects", "layers", "capabilities"], "keyed provider policy")
  text(policy.actionId, "provider Action id")
  if (!["sealed", "compensable", "irreversible"].includes(policy.tier as string)) fail("keyed provider requires an explicit recovery tier")
  // This first worker profile has no filesystem, host function or capability
  // adapter. Do not attest that such authority is present or enforced.
  if (canonicalJson(policy.effects) !== canonicalJson(EMPTY_EFFECTS) ||
    !Array.isArray(policy.layers) || policy.layers.length !== 0 ||
    !Array.isArray(policy.capabilities) || policy.capabilities.length !== 0) {
    fail("keyed source deployment currently requires empty hard effects, layers and capabilities")
  }
  return policy as unknown as KeyedProviderPolicy
}

const driverDigest = (): string => sha256Utf8(keyedBundleInvocationDriver("null"))
const compilerMatches = (claimed: unknown): boolean => canonicalJson(claimed) === canonicalJson(getNativeCompiler().identity)

/** Validate authenticated DATA; it does not mint any compiler or runtime proof. */
const validatePayload = (raw: unknown, runtime: KeyedWorkerRuntime): KeyedSourceDeployment => {
  const local = requireKeyedWorkerRuntime(runtime)
  const record = object(snapshotKeyedJSON(raw), "keyed source deployment")
  exact(record, ["deploymentVersion", "abi", "source", "compiler", "runtime", "driverDigest", "providers", "bundles", "executionDigest"], "keyed source deployment")
  if (record.deploymentVersion !== 1 || record.abi !== ABI) fail("unsupported keyed source deployment version")
  if (canonicalJson(sourceDeclaration(record.source)) !== canonicalJson(record.source)) fail("keyed source dependencies are not a canonical module set")
  if (!compilerMatches(record.compiler)) fail("keyed deployment compiler identity differs from the current native compiler")
  if (canonicalJson(record.runtime) !== canonicalJson(local.identity) || record.driverDigest !== driverDigest()) fail("keyed deployment runtime or invocation driver identity mismatch")
  if (!Array.isArray(record.providers) || !Array.isArray(record.bundles) || record.providers.length > 256 || record.bundles.length > 256) fail("keyed deployment requires bounded providers and bundles")
  const bundles = new Map<string, WorkerPoolBundle>(), pools = new Set<string>()
  let previous = ""
  for (const raw of record.bundles) {
    const bundle = validateWorkerPoolBundle(raw)
    if (bundles.has(bundle.digest) || pools.has(bundle.poolId) || bundle.poolId <= previous || bundle.actionIds.length === 0) fail("keyed bundles must have unique sorted pools and content identities")
    previous = bundle.poolId
    bundles.set(bundle.digest, bundle); pools.add(bundle.poolId)
  }
  previous = ""
  const covered = new Map<string, string[]>()
  for (const raw of record.providers) {
    const provider = object(raw, "deployed keyed provider")
    exact(provider, ["actionId", "tier", "effects", "layers", "capabilities", "action", "implementation", "bundleDigest"], "deployed keyed provider")
    const {action, implementation, bundleDigest, ...policyValue} = provider
    const policy = providerPolicy(policyValue)
    if (policy.actionId <= previous) fail("keyed providers must be sorted and unique")
    previous = policy.actionId
    const contract = validateActionContractDescriptor(action)
    const implementationContract = validateActionImplementationContract(implementation)
    assertActionImplementationContractMatchesAction(implementationContract, contract)
    if (contract.id !== policy.actionId || implementationContract.requirements.length !== 0 ||
      [contract.inputSchema, contract.successSchema, contract.errorSchema].some(schema => schema.shape !== "structural")) fail("keyed provider contract is not a structural capability-free boundary")
    const bundle = typeof bundleDigest === "string" ? bundles.get(bundleDigest) : undefined
    if (!bundle || !bundle.actionIds.includes(policy.actionId)) fail("keyed provider has no matching emitted bundle bytes")
    const ids = covered.get(bundle.digest) ?? []; ids.push(policy.actionId); covered.set(bundle.digest, ids)
  }
  for (const bundle of bundles.values()) if (canonicalJson(covered.get(bundle.digest) ?? []) !== canonicalJson(bundle.actionIds)) fail("keyed bundle contains unselected or missing Actions")
  const {executionDigest, ...material} = record
  if (typeof executionDigest !== "string" || digest(material) !== executionDigest) fail("keyed source deployment execution digest mismatch")
  return deepFreeze(record as unknown as KeyedSourceDeployment)
}

const built = new WeakSet<object>()
export interface BuildKeyedSourceDeploymentOptions {
  readonly source: KeyedSourceDeclaration
  readonly providers: readonly KeyedProviderPolicy[]
  readonly bundles: readonly WorkerPoolBundle[]
  readonly runtime: KeyedWorkerRuntime
}

/** Build from compiler-issued bundles, never from arbitrary claimed code hashes.
 * Source is checked without execution. The narrower symbolic profile and exact
 * source Action bindings are checked for EVERY invocation before publishing it. */
export const buildKeyedSourceDeployment = (options: BuildKeyedSourceDeploymentOptions): KeyedSourceDeployment => {
  const runtime = requireKeyedWorkerRuntime(options.runtime)
  const source = sourceDeclaration(snapshotKeyedJSON(options.source))
  const policies = snapshotKeyedJSON(options.providers)
  if (!Array.isArray(policies) || policies.length > 256 || !Array.isArray(options.bundles) || options.bundles.length > 256) fail("keyed deployment requires bounded provider selections")
  const selected = new Map<string, {action: ActionDescriptor; implementation: ActionImplementationContract; bundleDigest: string}>()
  const bundles = options.bundles.map(value => {
    const issued = requireCheckedKeyedWorkerPoolBundle(value)
    if (issued.target !== "typescript-deno" || issued.sandbox !== runtime.kind) fail("keyed bundle target or sandbox does not match the runtime")
    for (const selection of issued.selections) {
      if (selected.has(selection.action.id)) fail("keyed Action is selected by multiple bundles")
      selected.set(selection.action.id, {action: selection.action, implementation: selection.contract, bundleDigest: issued.bundle.digest})
    }
    return issued.bundle
  }).sort((a, b) => a.poolId < b.poolId ? -1 : a.poolId > b.poolId ? 1 : 0)
  const providers = policies.map(raw => {
    const policy = providerPolicy(raw), selection = selected.get(policy.actionId)
    if (!selection) return fail("keyed provider policy has no compiler-issued bundle")
    selected.delete(policy.actionId)
    return {...policy, ...selection}
  }).sort((a, b) => a.actionId < b.actionId ? -1 : a.actionId > b.actionId ? 1 : 0)
  if (selected.size) fail("keyed bundle includes Actions without explicit provider policies")
  const analysis = getNativeCompiler().analyzeLanguage({staticPlanCheck: true,
    files: [{fileName: source.fileName, source: source.source}, ...(source.dependencies ?? [])]
      .map(file => ({path: file.fileName, kind: "vibelang" as const, text: file.source}))})
  if (!analysis.checked || analysis.diagnostics.some(issue => issue.category === "error")) fail("keyed deployment source did not pass the native language checker")
  const material = {deploymentVersion: 1 as const, abi: ABI, source, compiler: getNativeCompiler().identity,
    runtime: runtime.identity, driverDigest: driverDigest(), providers, bundles}
  const deployment = validatePayload({...material, executionDigest: digest(material)}, options.runtime)
  built.add(deployment)
  return deployment
}

export interface AuthenticatedKeyedSourceDeployment {
  readonly [sourceBrand]: true
  readonly deployment: KeyedSourceDeployment
  readonly artifactDigest: string
  readonly signerKeyId: string
}
const authenticated = new WeakMap<object, {readonly deployment: KeyedSourceDeployment; readonly runtime: KeyedWorkerRuntime}>()

export const encodeSignedKeyedSourceDeployment = (deployment: KeyedSourceDeployment, key: DeploymentSigningKeyPair): Uint8Array => {
  if (deployment === null || typeof deployment !== "object" || !built.has(deployment)) fail("keyed source deployment was not issued by the checked builder")
  return encodeSignedKeyedSourceEnvelope(deployment, key)
}

/** Verify signatures before compiler queries, then match the actual local
 * compiler/runtime/driver and complete bundle bytes. No trust root is embedded. */
export const authenticateKeyedSourceDeployment = (
  bytes: Uint8Array | string, keys: readonly TrustedDeploymentKey[], runtime: KeyedWorkerRuntime,
): AuthenticatedKeyedSourceDeployment => {
  requireKeyedWorkerRuntime(runtime)
  const envelope = decodeSignedKeyedSourceEnvelope(bytes, keys)
  const deployment = validatePayload(envelope.payload, runtime)
  const proof = Object.freeze({[sourceBrand]: true as const, deployment, artifactDigest: envelope.artifactDigest, signerKeyId: envelope.signerKeyId})
  authenticated.set(proof, Object.freeze({deployment, runtime}))
  return proof
}

/** @internal Issuance lookup, not a structural test of attacker-owned fields. */
export const requireAuthenticatedKeyedSourceDeployment = (proof: AuthenticatedKeyedSourceDeployment) => {
  if (proof === null || typeof proof !== "object") return fail("keyed source authentication was not issued by the signature verifier")
  return authenticated.get(proof) ?? fail("keyed source authentication was not issued by the signature verifier")
}

export interface AuthenticatedKeyedInvocation {
  readonly [invocationBrand]: true
  readonly planId: string
  readonly planJson: string
  readonly planDigest: string
  readonly executionDigest: string
  /** Original JSON, preserving authored object order; not canonicalized data. */
  readonly inputJson: string
}
const invocations = new WeakMap<object, {readonly source: AuthenticatedKeyedSourceDeployment; readonly interpreter: KeyedSourceInterpreter}>()

/** Go compiles the signed source for this invocation; never execute a Flow to
 * discover its graph. This proof still conveys NO approval, readiness or lease. */
export const compileAuthenticatedKeyedInvocation = (
  source: AuthenticatedKeyedSourceDeployment, input: {readonly planId: string; readonly inputJson: string},
): AuthenticatedKeyedInvocation => {
  const {deployment} = requireAuthenticatedKeyedSourceDeployment(source)
  const values = object(snapshotKeyedJSON(input), "keyed invocation input")
  exact(values, ["planId", "inputJson"], "keyed invocation input")
  const planId = text(values.planId, "keyed invocation Plan id")
  if (typeof values.inputJson !== "string") fail("keyed invocation input must retain its original JSON text")
  if (!compilerMatches(deployment.compiler)) fail("keyed invocation compiler identity changed after authentication")
  const providers = deployment.providers.map(provider => ({actionId: provider.actionId,
    implementationId: provider.implementation.implementationId, implementationDigest: provider.bundleDigest,
    tier: provider.tier, effects: provider.effects, layers: provider.layers, capabilities: provider.capabilities}))
  const request: NativeKeyedSourceRequest = {...deployment.source, planId, inputJson: values.inputJson, providersJson: canonicalJson(providers)}
  const compiled = getNativeCompiler().compileKeyedPlanSource(request)
  if (!compiled.ok) fail(`authenticated source has no supported keyed invocation: ${compiled.diagnostics.map(issue => issue.code).join(", ")}`)
  const interpreter = new KeyedSourceInterpreter(compiled.planJson)
  const expected = new Map(deployment.providers.map(provider => [provider.actionId, provider]))
  const plan = JSON.parse(interpreter.planJson)
  for (const node of plan.nodes) {
    if (node.material.body.operation !== "action") continue
    const body = node.material.body, provider = expected.get(body.contract.id)
    if (!provider || canonicalJson(body.contract) !== canonicalJson(provider.action) ||
      body.implementationId !== provider.implementation.implementationId || body.implementationDigest !== provider.bundleDigest) fail("native source Action contract does not match its signed provider")
  }
  const proof = Object.freeze({[invocationBrand]: true as const, planId, planJson: interpreter.planJson,
    planDigest: interpreter.digest, executionDigest: deployment.executionDigest, inputJson: values.inputJson})
  invocations.set(proof, Object.freeze({source, interpreter}))
  return proof
}

/** Restore DATA from storage by recompiling the signed source, never by
 * promoting persisted proof-shaped fields into authority. Unknown Plan fields
 * refuse; formatting alone may differ. Input JSON retains its original order. */
export const restoreAuthenticatedKeyedInvocation = (
  source: AuthenticatedKeyedSourceDeployment,
  input: {readonly planId: string; readonly inputJson: string; readonly planJson: string},
): AuthenticatedKeyedInvocation => {
  requireAuthenticatedKeyedSourceDeployment(source)
  const values = object(snapshotKeyedJSON(input), "stored keyed invocation")
  exact(values, ["planId", "inputJson", "planJson"], "stored keyed invocation")
  if (typeof values.planJson !== "string" || typeof values.inputJson !== "string") fail("stored keyed invocation requires original input and Plan JSON")
  const checked = getNativeCompiler().keyedPlan({operation: "verify", inputJson: values.planJson})
  if (!checked.ok) fail("stored keyed invocation Plan failed native verification")
  const compiled = compileAuthenticatedKeyedInvocation(source, {planId: text(values.planId, "stored keyed Plan id"), inputJson: values.inputJson})
  if (canonicalJson(JSON.parse(values.planJson)) !== canonicalJson(JSON.parse(compiled.planJson))) fail("stored keyed Plan differs from its authenticated source invocation")
  return compiled
}

/** @internal Used only by the later approval/scheduler adapter. */
export const requireAuthenticatedKeyedInvocation = (proof: AuthenticatedKeyedInvocation) => {
  if (proof === null || typeof proof !== "object") return fail("keyed invocation was not issued by the authenticated native compiler")
  return invocations.get(proof) ?? fail("keyed invocation was not issued by the authenticated native compiler")
}

export interface KeyedApprovalEnvelope {
  readonly capabilities: readonly string[]
  readonly flows: readonly string[]
  readonly budget: {readonly tokens?: number; readonly milliseconds?: number}
  readonly host?: string
}
export interface KeyedApprovalTarget {
  readonly _tag: "Plan"
  readonly planId: string
  /** Control's complete invocation digest, NOT the keyed Plan digest. */
  readonly digest: string
  readonly envelope: KeyedApprovalEnvelope
}

/** Produce the exact reviewable Control target, not an approval or grant. The
 * full input participates even when no node consumes it. Array order in the
 * authority envelope is preserved, as required by the Control wire contract. */
export const keyedInvocationApprovalTarget = (
  invocation: AuthenticatedKeyedInvocation,
  options: {readonly envelope: KeyedApprovalEnvelope; readonly deployClass: boolean},
): KeyedApprovalTarget => {
  const issued = requireAuthenticatedKeyedInvocation(invocation)
  const raw = object(snapshotKeyedJSON(options), "keyed approval options")
  exact(raw, ["envelope", "deployClass"], "keyed approval options")
  if (typeof raw.deployClass !== "boolean") fail("keyed approval deployClass must be explicit")
  const envelope = object(raw.envelope, "keyed approval envelope")
  exact(envelope, ["capabilities", "flows", "budget", ...(Object.hasOwn(envelope, "host") ? ["host"] : [])], "keyed approval envelope")
  for (const field of ["capabilities", "flows"]) if (!Array.isArray(envelope[field]) || (envelope[field] as unknown[]).some(value => typeof value !== "string")) fail("keyed approval envelope lists must contain strings")
  if (Object.hasOwn(envelope, "host") && typeof envelope.host !== "string") fail("keyed approval host must be a string")
  const budget = object(envelope.budget, "keyed approval budget")
  if (Object.keys(budget).some(key => !["tokens", "milliseconds"].includes(key) || typeof budget[key] !== "number")) fail("keyed approval budget has unknown or nonnumeric fields")
  const material = {flowId: issued.interpreter.source.flowId, input: JSON.parse(invocation.inputJson),
    envelope, deployClass: raw.deployClass, executionDigest: invocation.executionDigest, persistedPlan: invocation.planDigest}
  return deepFreeze({_tag: "Plan", planId: invocation.planId, digest: digest(material), envelope: envelope as unknown as KeyedApprovalEnvelope})
}

export const SignedKeyedSourceDeployment = Object.freeze({build: buildKeyedSourceDeployment,
  encode: encodeSignedKeyedSourceDeployment, authenticate: authenticateKeyedSourceDeployment,
  compileInvocation: compileAuthenticatedKeyedInvocation, restoreInvocation: restoreAuthenticatedKeyedInvocation,
  approvalTarget: keyedInvocationApprovalTarget})
