import { dirname, resolve } from "node:path";
import * as ts from "typescript-js";
import { compileSmithers, type CompileOptions, type CompileResult } from "./compile.ts";
import {
  compileProject,
  type CompileProjectOptions,
  type CompileProjectResult,
} from "./project-compile.ts";
import type { ProjectSource } from "./model.ts";

export interface CheckedCompileOptions extends CompileOptions {
  /** Path whose directory determines resolution for generated imports. */
  readonly outputFileName: string;
}

export interface CheckedCompileResult {
  readonly result: CompileResult;
  readonly emitDiagnostics: readonly ts.Diagnostic[];
  readonly ok: boolean;
}

export interface CheckedProjectCompileResult {
  readonly result: CompileProjectResult;
  readonly emitDiagnostics: readonly ts.Diagnostic[];
  readonly ok: boolean;
}

/**
 * Validate generated TypeScript with a stock TypeScript Program. This is
 * Node-compatible and performs no filesystem writes.
 */
export function checkEmittedTypeScript(code: string, fileName: string): readonly ts.Diagnostic[] {
  const output = resolve(fileName);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    checkJs: true,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
  };
  const sourceFile = ts.createSourceFile(output, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    resolve(name) === output ? sourceFile : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  host.fileExists = (name) => resolve(name) === output || fileExists(name);
  host.readFile = (name) => resolve(name) === output ? code : readFile(name);
  const program = ts.createProgram([output], options, host);
  return ts.getPreEmitDiagnostics(program, program.getSourceFile(output));
}

/** Validate a complete generated module set through one stock TypeScript Program. */
export function checkEmittedProject(
  sources: readonly { readonly fileName: string; readonly code: string }[],
): readonly ts.Diagnostic[] {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    checkJs: true,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
  };
  const sourceByName = new Map<string, { code: string; sourceFile: ts.SourceFile }>();
  for (const source of sources) {
    const fileName = resolve(source.fileName);
    if (sourceByName.has(fileName)) throw new TypeError(`duplicate emitted project file '${fileName}'`);
    sourceByName.set(fileName, {
      code: source.code,
      sourceFile: ts.createSourceFile(fileName, source.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    });
  }
  const host = ts.createCompilerHost(options, true);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
    const authored = sourceByName.get(resolve(name));
    return authored?.sourceFile ?? getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  };
  host.fileExists = (name) => sourceByName.has(resolve(name)) || fileExists(name);
  host.readFile = (name) => sourceByName.get(resolve(name))?.code ?? readFile(name);
  host.resolveModuleNames = (moduleNames, containingFile) => moduleNames.map((moduleName) => {
    if (moduleName.startsWith(".")) {
      const authored = resolve(dirname(containingFile), moduleName);
      if (sourceByName.has(authored)) {
        return { resolvedFileName: authored, extension: ts.Extension.Ts, isExternalLibraryImport: false };
      }
    }
    return ts.resolveModuleName(moduleName, containingFile, options, host).resolvedModule;
  });
  const rootNames = [...sourceByName.keys()].sort();
  const program = ts.createProgram({ rootNames, options, host });
  return ts.getPreEmitDiagnostics(program);
}

/** One-call API for integrations which must never accept invalid generated TS. */
export function compileAndCheckSmithers(source: string, options: CheckedCompileOptions): CheckedCompileResult {
  const result = compileSmithers(source, options);
  const emitDiagnostics = result.analysis.diagnostics.some((diagnostic) => diagnostic.severity === "error")
    ? []
    : checkEmittedTypeScript(result.code, options.outputFileName)
        .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  return { result, emitDiagnostics, ok: emitDiagnostics.length === 0 &&
    !result.analysis.diagnostics.some((diagnostic) => diagnostic.severity === "error") };
}

/** Analyze, lower, and stock-check a complete in-memory `.sm` module set. */
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
    }))).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  return { result, emitDiagnostics, ok: !hasLanguageErrors && emitDiagnostics.length === 0 };
}
