import type {
  Analysis,
  AnalyzeOptions,
  AnalyzeProjectOptions,
  ErrorDeclaration,
  FunctionDeclaration,
  ProjectAnalysis,
  ProjectSource,
} from "./model.ts";
import { analyzeNativeSource } from "./native-analysis.ts";
import { analyzeNativeProject } from "./native-project.ts";

/** Native Go checked analysis; no emitted artifacts are exposed. */
export function analyzeSource(source: string, options: AnalyzeOptions = {}): Analysis {
  return analyzeNativeSource(source, options);
}

/**
 * Analyze direct static calls across an in-memory set of `.vibe` modules.
 * This is an analysis API only; project transform/declaration emit is deferred.
 */
export function analyzeProject(
  sources: readonly ProjectSource[],
  options: AnalyzeProjectOptions = {},
): ProjectAnalysis {
  return analyzeNativeProject(sources, options);
}

/** Ordinary Error subclasses replace the removed `error Name {}` grammar. */
export function parseErrors(source: string, options: AnalyzeOptions = {}): readonly ErrorDeclaration[] {
  return analyzeNativeSource(source, options).errors;
}

/** Native function declarations; facts on refused source are provisional. */
export function parseFunctions(source: string, options: AnalyzeOptions = {}): readonly FunctionDeclaration[] {
  return analyzeNativeSource(source, options).functions;
}
