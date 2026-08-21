export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

export interface ErrorDeclaration extends SourceSpan {
  readonly name: string;
  readonly fieldsSource: string;
}

export interface RequirementBinding {
  readonly name: string;
  readonly capability: string;
}

export interface FunctionDeclaration extends SourceSpan {
  readonly name: string;
  readonly exported: boolean;
  readonly async: boolean;
  readonly inferFailures: boolean;
  readonly declaredFailures: ReadonlySet<string> | undefined;
  readonly requirements: readonly RequirementBinding[];
  readonly bodyStart: number;
  readonly bodyEnd: number;
}

export interface CatchArm {
  readonly failure: string;
  readonly rethrows: boolean;
}

export interface CatchSite extends SourceSpan {
  readonly functionName?: string;
  readonly calledFunction?: string;
  readonly arms?: readonly CatchArm[];
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
  readonly failures: readonly string[];
  readonly requirements: readonly string[];
}

export interface Analysis {
  readonly errors: readonly ErrorDeclaration[];
  readonly functions: readonly FunctionDeclaration[];
  readonly rows: Readonly<Record<string, FunctionRows>>;
  readonly diagnostics: readonly Diagnostic[];
}
