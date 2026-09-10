/** Native Go compiler embedding API. No JavaScript compiler-library objects. */
export { NativeCompiler, getNativeCompiler } from "../poc/dist/compiler/native.js";
export type { NativeCompilerIdentity, NativeCompilerOptions } from "../poc/dist/compiler/native.js";
export { NativeCompilerError, NATIVE_API_VERSION } from "../poc/dist/compiler/protocol.js";
export type {
  CompilerJson, NativeSourceFile, NativeSourcePolicy, NativeCompileRequest, NativeCompileResult, NativeDiagnostic,
  NativeInspectionSource, NativeInspectionResult, NativeModuleSyntaxKind,
  NativeFormatRequest, NativeFormatResult, NativeTokenRequest, NativeTokenResult,
  NativeLoaderRegistrationRequest, NativeLoaderRegistrationResult,
  NativeAssetOutputRequest, NativeAssetOutputResult, NativeAssetImportsRequest, NativeAssetImportsResult,
  NativeTranspileRequest, NativeTranspileResult, NativeBundleModulesRequest, NativeBundleModulesResult,
  NativeCanonicalFunctionResult, NativeRuntimeModulesRequest, NativeRuntimeModulesResult,
  NativeRuntimeModuleFile, NativeRuntimeModuleEdge,
  NativeDurableModuleResult,
  NativeSyntaxSchemaResult,
  NativeCheckedSchemasRequest, NativeCheckedSchemasResult,
  NativeSourceRecoveryResult,
  NativeComptimePlanRange, NativeComptimePlanRequest, NativeComptimePlanResult,
  NativeLanguageAnalysisRequest, NativeLanguageAnalysisRuntimeModule, NativeLanguageAnalysisResult, NativeAnalyzedFile, NativeAnalyzedFunction, NativeAnalyzedError,
  NativeRuntimeFactoryRequest, NativeRuntimeFactoryResult,
  NativeActionContractRequest, NativeActionContractResult,
  NativePlanSourceRequest, NativePlanSourceResult,
  NativeKeyedPlanRequest, NativeKeyedPlanResult,
  NativeKeyedSourceRequest, NativeKeyedSourceResult,
  NativeCheckedFunctionRequest, NativeCheckedFunctionResult, NativeCheckedFunctionFacts,
  NativeConfigRequest, NativeConfigResult,
  NativeGeneratedProjectRequest, NativeGeneratedProjectResult,
  NativeBodyContractRequest, NativeBodyContractResult,
  NativeDeclarationRows, NativeDeclarationTextRequest, NativeDeclarationTextResult,
  NativeGeneratedDeclarationsRequest, NativeGeneratedDeclarationsResult,
} from "../poc/dist/compiler/protocol.js";
