import type { AdditionalRuntimeSource } from "./runtime-source-authority.ts";

export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

/** Ordinary Error subclass discovered through the TypeScript checker. */
export interface ErrorDeclaration extends SourceSpan {
  readonly name: string;
  readonly fieldsSource: string;
}

export type FunctionChannel = "plain" | "result" | "optional" | "result-optional";

/** Public, serializable view of a checked function. */
export interface FunctionDeclaration extends SourceSpan {
  readonly name: string;
  readonly exported: boolean;
  readonly async: boolean;
  readonly channel: FunctionChannel;
  readonly explicitReturn: boolean;
  readonly bodyStart: number;
  readonly bodyEnd: number;
}

/** Kept as a source-compatible name for callers of the first spike. */
export interface RequirementBinding {
  readonly name: string;
  readonly capability: string;
}

export interface Diagnostic {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly start: number;
  readonly line: number;
  readonly column: number;
}

export interface FunctionRows {
  /** Error class names, plus the distinguished `panic` foreign boundary. */
  readonly failures: readonly string[];
  /** Nominal Context subclass names, plus built-in requirements. */
  readonly requirements: readonly string[];
}

export interface Analysis {
  readonly errors: readonly ErrorDeclaration[];
  readonly functions: readonly FunctionDeclaration[];
  readonly rows: Readonly<Record<string, FunctionRows>>;
  readonly diagnostics: readonly Diagnostic[];
}

export interface AnalyzeOptions {
  /** Real path when imports should be resolved; a stable virtual path otherwise. */
  readonly fileName?: string;
}

/** One authored module supplied to the no-write project analyzer. */
export interface ProjectSource {
  /** Absolute, or relative to AnalyzeProjectOptions.rootDir. Must end in `.sm`. */
  readonly fileName: string;
  readonly source: string;
}

export interface AnalyzeProjectOptions {
  /** Resolution base for relative source names. Defaults to process.cwd(). */
  readonly rootDir?: string;
  /**
   * Compiler-generated TypeScript modules addressable from authored imports.
   * They participate in checker resolution but are never parsed as `.sm`,
   * row-analyzed, or emitted by this API. The caller must separately map and
   * emit their exact source identities.
   */
  readonly additionalRuntimeSources?: readonly AdditionalRuntimeSource[];
}

/** A normal language diagnostic with its project source identity attached. */
export interface ProjectDiagnostic extends Diagnostic {
  readonly fileName: string;
}

export interface ProjectFileAnalysis extends Analysis {
  readonly fileName: string;
}

/**
 * Stable, serializable output of the bounded whole-project row pass. Files are
 * keyed by the exact ProjectSource.fileName supplied by the caller.
 */
export interface ProjectAnalysis {
  readonly files: Readonly<Record<string, ProjectFileAnalysis>>;
  readonly diagnostics: readonly ProjectDiagnostic[];
}
