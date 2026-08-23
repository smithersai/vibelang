import ts from "typescript-js";
import {
  annotateDeclarationEffects,
  analyzeProject,
  analyzeSource,
  checkEmittedProject,
  checkEmittedTypeScript,
  composeSourceMaps,
  compileAndCheckProject,
  compileAndCheckSmithers,
  compileProject,
  compileSmithers,
  DECLARATION_EFFECT_TAG,
  DECLARATION_EFFECT_VERSION,
  emitProjectDeclarations,
  normalizeDeclarationEffectChannels,
  parseErrors,
  parseFunctions,
  readDeclarationEffects,
} from "../poc/dist/language/index.js";

export {
  annotateDeclarationEffects,
  analyzeProject,
  analyzeSource,
  checkEmittedProject,
  checkEmittedTypeScript,
  composeSourceMaps,
  compileAndCheckProject,
  compileAndCheckSmithers,
  compileProject,
  compileSmithers,
  DECLARATION_EFFECT_TAG,
  DECLARATION_EFFECT_VERSION,
  emitProjectDeclarations,
  normalizeDeclarationEffectChannels,
  parseErrors,
  parseFunctions,
  readDeclarationEffects,
};
export type {
  Analysis,
  AnalyzeProjectOptions,
  CheckedCompileOptions,
  CheckedCompileResult,
  CheckedProjectCompileResult,
  CompileProjectOptions,
  CompileProjectResult,
  CompiledProjectFile,
  DeclarationEmitResult,
  DeclarationOutput,
  DeclarationSource,
  CompileOptions as SmithersCompileOptions,
  CompileResult as SmithersCompileResult,
  Diagnostic as SmithersDiagnostic,
  FunctionRows,
  ProjectAnalysis,
  ProjectDiagnostic,
  ProjectFileAnalysis,
  ProjectSource,
} from "../poc/dist/language/index.js";

export const version = "0.0.1";
export const typescriptVersion = ts.version;
export const typescript = ts;

export type CompilerOptions = ts.CompilerOptions;
export type CompilerHost = ts.CompilerHost;
export type Program = ts.Program;
export type TypeChecker = ts.TypeChecker;
export type LanguageService = ts.LanguageService;
export type LanguageServiceHost = ts.LanguageServiceHost;
export type Diagnostic = ts.Diagnostic;
export type SourceFile = ts.SourceFile;

export class NotImplementedError extends Error {
  readonly code = "SMITHERS_NOT_IMPLEMENTED";
  readonly feature: string;

  constructor(feature: string) {
    super(`${feature} is not implemented in Smithers ${version}`);
    this.name = "NotImplementedError";
    this.feature = feature;
  }
}

function containsSmithersFile(rootNames: readonly string[]): boolean {
  return rootNames.some((fileName) => fileName.endsWith(".sm") || fileName.endsWith(".smx"));
}

/** TypeScript-compatible Program creation. Use compileSmithers for `.sm` source. */
export const createProgram: typeof ts.createProgram = ((...args: unknown[]) => {
  const first = args[0];
  const rootNames = Array.isArray(first)
    ? first
    : typeof first === "object" && first !== null && "rootNames" in first
      ? (first as { rootNames: readonly string[] }).rootNames
      : [];

  if (containsSmithersFile(rootNames)) {
    throw new NotImplementedError("TypeScript-compatible createProgram for .sm; use analyzeProject or compileAndCheckProject");
  }
  return (ts.createProgram as (...values: unknown[]) => ts.Program)(...args);
}) as typeof ts.createProgram;

/** Delegate ordinary TypeScript transpilation and reject unsupported Smithers grammar explicitly. */
export const transpileModule: typeof ts.transpileModule = ((
  input: string,
  options: ts.TranspileOptions,
) => {
  if (options.fileName?.endsWith(".sm") || options.fileName?.endsWith(".smx")) {
    throw new NotImplementedError(".sm transpilation");
  }
  return ts.transpileModule(input, options);
}) as typeof ts.transpileModule;

export const createLanguageService: typeof ts.createLanguageService = ts.createLanguageService;
export const createDocumentRegistry: typeof ts.createDocumentRegistry = ts.createDocumentRegistry;

export interface CompilerExtension {
  readonly name: string;
  readonly apiVersion: 1;
  readonly extensions: readonly string[];
  parse?(source: string, fileName: string): never;
  check?(program: Program): readonly Diagnostic[];
  lower?(sourceFile: SourceFile): SourceFile;
}

export function defineCompilerExtension<T extends CompilerExtension>(extension: T): T {
  return extension;
}
