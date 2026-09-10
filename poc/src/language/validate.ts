import { compileVibeLang, type CompileOptions, type CompileResult } from "./compile.ts";
import {
  compileProject,
  type CompileProjectOptions,
  type CompileProjectResult,
} from "./project-compile.ts";
import type { ProjectSource } from "./model.ts";

import { checkEmittedProject, checkEmittedTypeScript, type EmittedDiagnostic } from "./generated-check.ts";
export { checkEmittedProject, checkEmittedTypeScript, DEFAULT_RUNTIME_IMPORT } from "./generated-check.ts";
export type { EmittedDiagnostic, EmittedModuleResolutionOptions } from "./generated-check.ts";

export interface CheckedCompileOptions extends CompileOptions {
  /** Path whose directory determines resolution for generated imports. */
  readonly outputFileName: string;
}

export interface CheckedCompileResult {
  readonly result: CompileResult;
  readonly emitDiagnostics: readonly EmittedDiagnostic[];
  readonly ok: boolean;
}

export interface CheckedProjectCompileResult {
  readonly result: CompileProjectResult;
  readonly emitDiagnostics: readonly EmittedDiagnostic[];
  readonly ok: boolean;
}

/** One-call API for integrations which must never accept invalid generated TS. */
export function compileAndCheckVibeLang(source: string, options: CheckedCompileOptions): CheckedCompileResult {
  const result = compileVibeLang(source, options);
  const emitDiagnostics = result.analysis.diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? []
    : checkEmittedTypeScript(result.code, options.outputFileName)
        .filter((diagnostic) => diagnostic.category === "error");
  return { result, emitDiagnostics, ok: emitDiagnostics.length === 0 &&
    !result.analysis.diagnostics.some((diagnostic) => diagnostic.severity === "error") };
}

/** Analyze, lower, and native-check a complete in-memory `.vibe` module set. */
export function compileAndCheckProject(
  sources: readonly ProjectSource[],
  options: CompileProjectOptions,
): CheckedProjectCompileResult {
  const result = compileProject(sources, options);
  const hasLanguageErrors = result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const emitDiagnostics = hasLanguageErrors
    ? []
    : checkEmittedProject(Object.values(result.files).map((file) => ({
      fileName: file.outputFileName,
      code: file.code,
    }))).filter((diagnostic) => diagnostic.category === "error");
  return { result, emitDiagnostics, ok: !hasLanguageErrors && emitDiagnostics.length === 0 };
}
