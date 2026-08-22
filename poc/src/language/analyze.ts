import type {
  Analysis,
  AnalyzeOptions,
  AnalyzeProjectOptions,
  ErrorDeclaration,
  FunctionDeclaration,
  ProjectAnalysis,
  ProjectSource,
} from "./model.ts";
import { buildSemanticModel, buildSemanticProject } from "./semantic.ts";

/** Run the TypeScript-backed VibeLang semantic pass without emitting code. */
export function analyzeSource(source: string, options: AnalyzeOptions = {}): Analysis {
  const model = buildSemanticModel(source, options);
  return {
    errors: model.errors,
    functions: model.publicFunctions,
    rows: model.rows,
    diagnostics: model.diagnostics,
  };
}

/**
 * Analyze direct static calls across an in-memory set of `.vibe` modules.
 * This is an analysis API only; project transform/declaration emit is deferred.
 */
export function analyzeProject(
  sources: readonly ProjectSource[],
  options: AnalyzeProjectOptions = {},
): ProjectAnalysis {
  return buildSemanticProject(sources, options);
}

/** Ordinary Error subclasses replace the removed `error Name {}` grammar. */
export function parseErrors(source: string, options: AnalyzeOptions = {}): readonly ErrorDeclaration[] {
  return buildSemanticModel(source, options).errors;
}

/** Checked function declarations; this no longer scans historical row syntax. */
export function parseFunctions(source: string, options: AnalyzeOptions = {}): readonly FunctionDeclaration[] {
  return buildSemanticModel(source, options).publicFunctions;
}
