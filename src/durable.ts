/**
 * Platform-neutral durable source compilation and Plan artifact validation.
 * Execution and provider installation remain on `vibelang/durable/bun` because
 * the POC coordinator persists through Bun's SQLite runtime.
 */
export {
  compileDurableSource,
  DurableSourceCompiler,
  type DurableSourceActionBinding,
  type DurableSourceCompileFailure,
  type DurableSourceCompileOptions,
  type DurableSourceCompileResult,
  type DurableSourceCompileSuccess,
  type DurableSourceDiagnostic,
} from "../poc/dist/durable/source-compiler.js";

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
