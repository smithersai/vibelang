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

export type FunctionChannel = "plain" | "result";

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
  /** Nominal `Context` subclass names. There are no built-in members. */
  readonly requirements: readonly string[];
}

/**
 * The JSDoc tag an emitted declaration carries its own effect row in.
 *
 * `specification/compatibility.mdx` §TypeScript Target: "Requirement metadata
 * does not erase completely. **Whatever representation is chosen** MUST
 * additionally carry whether a function is effectful, because a cross-module
 * caller cannot lower its call site without that fact." This tag is that
 * representation, and `declarations.ts` both writes and reads it.
 *
 * This shared data leaf keeps the remaining frontend independent of the
 * declaration writer's native host transport. Compiler-library objects are
 * not needed merely to name or publish the versioned contract.
 */
export const DECLARATION_EFFECT_TAG = "vibelangEffects";
export const DECLARATION_EFFECT_VERSION = 2 as const;

export interface Analysis {
  readonly errors: readonly ErrorDeclaration[];
  readonly functions: readonly FunctionDeclaration[];
  readonly rows: Readonly<Record<string, FunctionRows>>;
  readonly diagnostics: readonly Diagnostic[];
}

export interface AnalyzeOptions {
  /** Real path when imports should be resolved; a stable virtual path otherwise. */
  readonly fileName?: string;
  /** Explicit root for bounded dependency resolution, including parent imports.
   * Defaults to cwd for relative names or the containing directory for absolute names. */
  readonly rootDir?: string;
  /** Runtime selector for source-free SDK declarations. Defaults to this SDK. */
  readonly runtimeImport?: string;
}

/** One authored module supplied to the no-write project analyzer. */
export interface ProjectSource {
  /** Absolute, or relative to AnalyzeProjectOptions.rootDir. Must end in `.vibe`. */
  readonly fileName: string;
  readonly source: string;
}

export interface AnalyzeProjectOptions {
  /** Return the Go resolver's bounded file/directory read/probe inventory. */
  readonly traceDependencies?: boolean;
  /** Resolution base and dependency boundary. Defaults to cwd for relative names;
   * absolute-only sources outside cwd use their smallest common directory.
   * Specify this explicitly to pin portable multi-file nominal identities. */
  readonly rootDir?: string;
  /** Runtime selector for source-free SDK declarations. Defaults to this SDK. */
  readonly runtimeImport?: string;
  /**
   * Compiler-generated TypeScript modules addressable from authored imports.
   * They participate in checker resolution but are never parsed as `.vibe`,
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
  readonly dependencies?: import("../compiler/protocol.ts").NativeDependencyTrace;
  readonly files: Readonly<Record<string, ProjectFileAnalysis>>;
  readonly diagnostics: readonly ProjectDiagnostic[];
}
