export { analyzeProject, analyzeSource, parseErrors, parseFunctions } from "./analyze.ts";
export { compileVibeLang } from "./compile.ts";
export {
  FORBIDDEN_COMPILER_OPTIONS,
  isKnownCompilerOption,
  MANDATORY_CHECKER_OPTIONS,
  MANDATORY_COMPILER_OPTIONS,
  validateVibeLangTsconfig,
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
  compileAndCheckVibeLang,
  DEFAULT_RUNTIME_IMPORT,
} from "./validate.ts";
export type { CompileOptions, CompileResult } from "./compile.ts";
export type { EmittedDiagnostic } from "./generated-check.ts";
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
export { formatVibeLangSource, isFormattedVibeLangSource, vibelangTokenAt } from "./format.ts";
export { startVibeLangLanguageServer } from "./lsp.ts";
export type {
  FormatDiagnostic,
  FormatDiagnosticCode,
  FormatOptions,
  FormatResult,
  VibeLangToken,
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
