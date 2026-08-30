export { analyzeProject, analyzeSource, parseErrors, parseFunctions } from "./analyze.ts";
export { compileSmithers } from "./compile.ts";
export {
  FORBIDDEN_COMPILER_OPTIONS,
  isKnownCompilerOption,
  MANDATORY_CHECKER_OPTIONS,
  MANDATORY_COMPILER_OPTIONS,
  validateSmithersTsconfig,
} from "./compiler-options.ts";
export type { CompilerOptionDiagnostic } from "./compiler-options.ts";
export {
  annotateDeclarationEffects,
  DECLARATION_EFFECT_TAG,
  DECLARATION_EFFECT_VERSION,
  emitProjectDeclarations,
  normalizeDeclarationEffectChannels,
  readDeclarationEffects,
} from "./declarations.ts";
export { composeSourceMaps } from "./source-map.ts";
export { compileProject } from "./project-compile.ts";
export {
  checkEmittedProject,
  checkEmittedTypeScript,
  compileAndCheckProject,
  compileAndCheckSmithers,
  createEmittedModuleResolver,
  DEFAULT_RUNTIME_IMPORT,
} from "./validate.ts";
export type { CompileOptions, CompileResult, EffectLowering } from "./compile.ts";
export type {
  DeclarationEmitResult,
  DeclarationOutput,
  DeclarationSource,
} from "./declarations.ts";
export type {
  CompileProjectOptions,
  CompileProjectResult,
  CompiledProjectFile,
} from "./project-compile.ts";
export type {
  CheckedCompileOptions,
  CheckedCompileResult,
  CheckedProjectCompileResult,
  EmittedModuleResolutionOptions,
} from "./validate.ts";
export { formatSmithersSource, isFormattedSmithersSource, smithersTokenAt } from "./format.ts";
export { startSmithersLanguageServer } from "./lsp.ts";
export type {
  FormatDiagnostic,
  FormatDiagnosticCode,
  FormatOptions,
  FormatResult,
  SmithersToken,
} from "./format.ts";
export type { LanguageServerHandle, LanguageServerOptions } from "./lsp.ts";
export type {
  Analysis,
  AnalyzeOptions,
  AnalyzeProjectOptions,
  Diagnostic,
  ErrorDeclaration,
  FunctionChannel,
  FunctionDeclaration,
  FunctionRows,
  RequirementBinding,
  ProjectAnalysis,
  ProjectDiagnostic,
  ProjectFileAnalysis,
  ProjectSource,
} from "./model.ts";
