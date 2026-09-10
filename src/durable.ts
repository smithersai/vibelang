/**
 * Platform-neutral durable source compilation and executable artifact validation.
 * The authenticated keyed node worker also runs on Node. Scheduler admission
 * and durable storage belong to its host; the historical body coordinator
 * remains on `vibelang/durable/bun` because it uses Bun's SQLite runtime.
 */
export {
  KeyedSourceInterpreter, KeyedSourceInterpreterError, KeyedSourceEvaluationError,
  type KeyedSourceEvidence, type KeyedSourceNodeInspection, type KeyedResolvedInput, type PreparedKeyedNode,
} from "../poc/dist/durable/keyed-interpreter.js";
export {
  KeyedControlError, type KeyedControl, type KeyedControlTicket, type KeyedControlInspection, type KeyedControlStatus,
} from "../poc/dist/durable/keyed-control.js";
export {
  encodeKeyedValue, decodeKeyedValue, keyedValuePath, KeyedValueError, KEYED_VALUE_LIMITS, type KeyedValue,
} from "../poc/dist/durable/keyed-value.js";
export {
  createAuthenticatedKeyedNodeWorker, KeyedNodeExecutionError,
  type AuthenticatedKeyedNodeWorker, type KeyedNodeWork, type KeyedNodeExit,
} from "../poc/dist/durable/keyed-executor.js";
export {
  createKeyedWorkerRuntime, buildKeyedSourceDeployment, encodeSignedKeyedSourceDeployment,
  authenticateKeyedSourceDeployment, compileAuthenticatedKeyedInvocation, restoreAuthenticatedKeyedInvocation,
  keyedInvocationApprovalTarget,
  SignedKeyedSourceDeployment, KeyedDeploymentError,
  type KeyedSourceDeclaration, type KeyedProviderPolicy, type KeyedDeployedProvider,
  type KeyedSourceDeployment, type KeyedWorkerRuntime, type BuildKeyedSourceDeploymentOptions,
  type AuthenticatedKeyedSourceDeployment, type AuthenticatedKeyedInvocation, type KeyedApprovalEnvelope, type KeyedApprovalTarget,
} from "../poc/dist/durable/keyed-deployment.js";

export {
  compileDurableFlow,
  compileDurableSource,
  compileEffectManifest,
  DurableSourceCompiler,
  PlanUnrepresentable,
  type DurableFlowCompileResult,
  type DurableFlowCompileSuccess,
  type DurableFlowDescriptor,
  type DurableSourceActionBinding,
  type DurableSourceCompileFailure,
  type DurableSourceCompileOptions,
  type DurableSourceCompileResult,
  type DurableSourceCompileSuccess,
  type DurableSourceDiagnostic,
  type EffectManifestCompileResult,
  type EffectManifestCompileSuccess,
} from "../poc/dist/durable/source-compiler.js";

export { compileDurableBody, type DurableBodyCompileResult } from "../poc/dist/durable/body-compiler.js";
export { compileDurableModule, type DurableModuleCompileResult } from "../poc/dist/durable/module-compiler.js";
export { validateDurableBodyArtifact, type DurableBodyArtifact } from "../poc/dist/durable/body-artifact.js";
export { validateEffectManifest } from "../poc/dist/durable/manifest-artifact.js";

/**
 * Historical Effect Manifest inspection, selected explicitly by
 * `vibe plan --profile manifest-compat`. The default Plan command publishes
 * the native keyed graph instead; a Manifest is not that graph or its approval.
 *
 * `canonicalJson` and `digest` ride with it deliberately. The CLI writes the
 * Manifest's OWN canonical bytes to `--outFile`, and `manifest.digest` is
 * `digest(...)` over exactly that serialization minus the digest field. Without
 * these two a consumer can read the file but cannot check that its declared
 * identity is the identity of its contents, which is the only property that
 * makes a published artifact worth publishing.
 */
export type {
  EffectManifest,
  EffectManifestAction,
  EffectManifestContract,
  EffectManifestSite,
} from "../poc/dist/durable/effect-manifest.js";
export { canonicalJson, digest } from "../poc/dist/durable/value.js";

export {
  decodePlanArtifact,
  DurableArtifactError,
  encodePlanArtifact,
  loadCompiledFlow,
  PlanArtifact,
  validatePlanTemplate,
  type StaticPlanArtifact,
} from "../poc/dist/durable/artifact.js";

export {
  actionDeclarationFromDescriptor,
  compileActionContract,
  durableErrorPayload,
  DurableCodecError,
  DurableContractCompiler,
  validateActionContractDescriptor,
  validateDurableSchema,
  validateDurableTypeDescriptor,
  validateDurableValue,
  type ActionContractDiagnostic,
  type CompileActionContractOptions,
  type CompileActionContractResult,
} from "../poc/dist/durable/schema.js";

export {
  ActionImplementationContractError,
  compileActionImplementationContract,
  compileActionImplementationSourceContract,
  validateActionImplementationContract,
  type CompileActionImplementationOptions,
  type CompileActionImplementationSourceOptions,
} from "../poc/dist/durable/implementation-contract.js";

export {
  buildWorkerPoolBundle,
  validateWorkerPoolBundle,
  WorkerPoolBundleError,
  WorkerPoolBundles,
  type BuildWorkerPoolBundleOptions,
  type WorkerPoolBundle,
  type WorkerPoolBundleSelection,
} from "../poc/dist/durable/pool-bundle.js";

/**
 * Canonical Ed25519 deployment envelopes are Node-safe. The coordinator gate
 * itself remains on `vibelang/durable/bun` with the SQLite executor.
 */
export {
  authenticateDeployment,
  decodeSignedDeploymentArtifact,
  deploymentVerificationKey,
  DeploymentSignatureError,
  encodeSignedDeploymentArtifact,
  generateDeploymentSigningKeyPair,
  requireAuthenticatedDeployment,
  SignedDeployment,
  SignedBodyDeployment,
  type AuthenticatedBodyDeployment,
  type SignedBodyDeploymentArtifact,
  type AuthenticatedDeployment,
  type DeploymentSigningKeyPair,
  type SignedDeploymentArtifact,
  type TrustedDeploymentKey,
} from "../poc/dist/durable/signed-deployment.js";

export type { CompiledFlow } from "../poc/dist/durable/authoring.js";
export { MAX_DURABLE_JSON_NODES } from "../poc/dist/durable/ir.js";
export type {
  ActionDescriptor,
  ActionImplementationContract,
  ActionNode,
  DeploymentManifest,
  DurableObjectField,
  DurableScalar,
  DurableSchema,
  DurableTypeDescriptor,
  FanOutNode,
  FanOutTemplateExpr,
  FlowSchemas,
  JsonPrimitive,
  JsonValue,
  LegacyDurableSchema,
  PlanFragment,
  PlanNode,
  PlanTemplate,
  SignalNode,
  StructuralDurableSchema,
  ValueExpr,
} from "../poc/dist/durable/ir.js";
