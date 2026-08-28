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
 * How a checker reaches the modules the compiler itself imports from.
 *
 * A generated module imports its runtime through a package seam — `smthrs/...`
 * — which only resolves from an installed consumer. A checker running inside
 * this repository, or over an `--outDir` anywhere on the filesystem, has to be
 * told where that package lives.
 *
 * It is told here, in module *resolution*, and never by rewriting module
 * *text*. A caller that rewrote the seam into a local path before checking was
 * type-checking a program it would never emit: the substitution ran over the
 * whole module, so an authored string literal or literal type spelled
 * `"smthrs/runtime"` was rewritten too, and `check` and `run` reached opposite
 * verdicts on the same source in both directions. Because the override is
 * keyed by specifier and consumed by the resolver, the bytes a checker sees
 * are by construction the bytes that were emitted.
 */
export const DEFAULT_RUNTIME_IMPORT = "smthrs/runtime";

export interface EmittedModuleResolutionOptions {
  /**
   * Compiler-written bare specifiers mapped to the file that declares them.
   * The mapped path is resolved by stock TypeScript, so a `.js` entry point
   * finds its sibling declaration exactly as an installed consumer would.
   */
  readonly moduleOverrides?: Readonly<Record<string, string>>;
}

/**
 * The one module resolver every emitted-module Program shares: authored
 * relative edges inside the batch, compiler-written package seams through the
 * override table, everything else through stock resolution.
 */
export function createEmittedModuleResolver(
  isProjectFile: (fileName: string) => boolean,
  options: ts.CompilerOptions,
  host: ts.ModuleResolutionHost,
  moduleOverrides: Readonly<Record<string, string>> | undefined,
): (moduleNames: readonly string[], containingFile: string) => (ts.ResolvedModuleFull | undefined)[] {
  return (moduleNames, containingFile) => moduleNames.map((moduleName) => {
    if (moduleName.startsWith(".")) {
      const authored = resolve(dirname(containingFile), moduleName);
      if (isProjectFile(authored)) {
        return { resolvedFileName: authored, extension: ts.Extension.Ts, isExternalLibraryImport: false };
      }
    }
    if (moduleOverrides && Object.hasOwn(moduleOverrides, moduleName)) {
      const packaged = moduleOverrides[moduleName]!;
      return ts.resolveModuleName(packaged, containingFile, options, host).resolvedModule;
    }
    return ts.resolveModuleName(moduleName, containingFile, options, host).resolvedModule;
  });
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
  resolution?: EmittedModuleResolutionOptions,
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
  host.resolveModuleNames = createEmittedModuleResolver(
    (fileName) => sourceByName.has(fileName),
    options,
    host,
    resolution?.moduleOverrides,
  );
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
