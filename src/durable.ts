/**
 * Platform-neutral durable source compilation and Plan artifact validation.
 * Execution and provider installation remain on `smthrs/durable/bun` because
 * the POC coordinator persists through Bun's SQLite runtime.
 */
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

/**
 * The Effect Manifest — the artifact `smithers plan` reports as of
 * `MIGRATION-PLAN.md` step 12, and the one a Flow always publishes.
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
  validateActionImplementationContract,
  type CompileActionImplementationOptions,
} from "../poc/dist/durable/implementation-contract.js";

/**
 * Canonical Ed25519 deployment envelopes are Node-safe. The coordinator gate
 * itself remains on `smthrs/durable/bun` with the SQLite executor.
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
