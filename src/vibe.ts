import ts from "typescript-js";

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
  readonly code = "VIBE_NOT_IMPLEMENTED";
  readonly feature: string;

  constructor(feature: string) {
    super(`${feature} is not implemented in VibeLang ${version}`);
    this.name = "NotImplementedError";
    this.feature = feature;
  }
}

function containsVibeFile(rootNames: readonly string[]): boolean {
  return rootNames.some((fileName) => fileName.endsWith(".vibe") || fileName.endsWith(".vibex"));
}

/** TypeScript-compatible program creation until the Go frontend accepts `.vibe`. */
export const createProgram: typeof ts.createProgram = ((...args: unknown[]) => {
  const first = args[0];
  const rootNames = Array.isArray(first)
    ? first
    : typeof first === "object" && first !== null && "rootNames" in first
      ? (first as { rootNames: readonly string[] }).rootNames
      : [];

  if (containsVibeFile(rootNames)) throw new NotImplementedError(".vibe parser and checker");
  return (ts.createProgram as (...values: unknown[]) => ts.Program)(...args);
}) as typeof ts.createProgram;

/** Delegate ordinary TypeScript transpilation and reject unsupported VibeLang grammar explicitly. */
export const transpileModule: typeof ts.transpileModule = ((
  input: string,
  options: ts.TranspileOptions,
) => {
  if (options.fileName?.endsWith(".vibe") || options.fileName?.endsWith(".vibex")) {
    throw new NotImplementedError(".vibe transpilation");
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

export function compileVibe(_rootNames: readonly string[], _options: CompilerOptions = {}): never {
  throw new NotImplementedError("VibeLang compilation");
}

