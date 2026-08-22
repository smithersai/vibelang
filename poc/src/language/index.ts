export { analyzeProject, analyzeSource, parseErrors, parseFunctions } from "./analyze.ts";
export { compileVibe } from "./compile.ts";
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
  compileAndCheckVibe,
} from "./validate.ts";
export { formatVibeSource, isFormattedVibeSource, vibeTokenAt } from "./format.ts";
export type {
  FormatDiagnostic,
  FormatDiagnosticCode,
  FormatOptions,
  FormatResult,
  VibeToken,
} from "./format.ts";
export type { CompileOptions, CompileResult } from "./compile.ts";
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
} from "./validate.ts";
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
