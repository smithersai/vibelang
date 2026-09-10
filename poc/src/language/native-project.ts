import { existsSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { getNativeCompiler } from "../compiler/native.ts";
import type { NativeLanguageAnalysisRuntimeModule, NativeSourceFile, NativeLanguageAnalysisRequest, NativeLanguageAnalysisResult } from "../compiler/protocol.ts";
import type { AnalyzeProjectOptions, ProjectAnalysis, ProjectSource } from "./model.ts";
import { nativeFileAnalysis, analysisRuntimeImport } from "./native-analysis.ts";
import { isCompilerIssuedRuntimeSource } from "./runtime-source-authority.ts";

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const beneath = (root: string, name: string): boolean => {
  const path = relative(root, name);
  return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};
const validPath = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "" && !value.includes("\0") && value.length <= 16 * 1024;

/** Filesystem addressing stays in the host; binding, checking, alias exports,
 * provenance and row inference all belong to one native Go query. */
export function analyzeNativeProject(sources: readonly ProjectSource[], options: AnalyzeProjectOptions = {}): ProjectAnalysis {
  const prepared = prepareNativeProject(sources, options);
  return nativeProjectAnalysis(prepared, getNativeCompiler().analyzeLanguage({...prepared.request, sdkRuntimeImport:analysisRuntimeImport(options)}));
}

export interface PreparedNativeProject {
  readonly rootDir: string;
  readonly request: NativeLanguageAnalysisRequest;
  readonly paths: ReadonlyMap<string, { readonly input: ProjectSource; readonly absolute: string }>;
}

/** Reused by native emit: this stages paths and host inputs, never compiler objects. */
export function prepareNativeProject(sources: readonly ProjectSource[], options: AnalyzeProjectOptions = {}): PreparedNativeProject {
  if (!Array.isArray(sources) || !options || typeof options !== "object" || Array.isArray(options) ||
    (options.rootDir !== undefined && !validPath(options.rootDir)) ||
    (options.traceDependencies !== undefined && typeof options.traceDependencies !== "boolean") ||
    (options.additionalRuntimeSources !== undefined && !Array.isArray(options.additionalRuntimeSources))) {
    throw new TypeError("project analysis requires a source array and valid rootDir/runtime source options");
  }
  const base = resolve(options.rootDir ?? process.cwd());
  const displayNames = new Set<string>();
  const absoluteNames = new Set<string>();
  const staged = sources.map((input, index) => {
    if (!input || typeof input !== "object" || !validPath(input.fileName) || typeof input.source !== "string") {
      throw new TypeError(`project source ${index} has an invalid shape`);
    }
    if (!input.fileName.endsWith(".vibe")) throw new TypeError(`project source '${input.fileName}' must end in .vibe`);
    if (displayNames.has(input.fileName)) throw new TypeError(`duplicate project source name '${input.fileName}'`);
    const absolute = resolve(base, input.fileName);
    if (absoluteNames.has(absolute)) throw new TypeError(`project source '${input.fileName}' resolves to a duplicate path`);
    displayNames.add(input.fileName);
    absoluteNames.add(absolute);
    return { input, absolute };
  }).sort((left, right) => compare(left.input.fileName, right.input.fileName));

  let root = base;
  if (options.rootDir === undefined && staged.every(entry => isAbsolute(entry.input.fileName)) &&
    staged.some(entry => !beneath(root, entry.absolute))) {
    // Absolute-only projects outside cwd use their smallest common directory.
    // Cwd never becomes part of their nominal module names. For multi-file
    // portable identity, an explicit root remains the unambiguous contract.
    root = dirname(staged[0]!.absolute);
    for (const entry of staged) while (!beneath(root, entry.absolute) && dirname(root) !== root) root = dirname(root);
    if (dirname(root) === root) throw new TypeError("project sources need an explicit common rootDir");
  }
  const logical = (absolute: string, description: string): string => {
    if (!beneath(root, absolute)) throw new TypeError(`${description} must be beneath the project root`);
    return relative(root, absolute).split(sep).join("/");
  };
  const files: NativeSourceFile[] = staged.map(entry => ({
    path: logical(entry.absolute, `project source '${entry.input.fileName}'`), kind: "vibelang", text: entry.input.source,
  }));
  const paths = new Map(staged.map((entry, index) => [files[index]!.path, entry]));
  const claimed = new Set(absoluteNames);
  const runtimeModules: NativeLanguageAnalysisRuntimeModule[] = [];
  for (const [index, input] of (options.additionalRuntimeSources ?? []).entries()) {
    if (!input || typeof input !== "object" || !validPath(input.sourceFileName) || typeof input.source !== "string" ||
      (input.resolutionAliases !== undefined && (!Array.isArray(input.resolutionAliases) || !input.resolutionAliases.every(validPath)))) {
      throw new TypeError(`additional runtime source ${index} has an invalid shape`);
    }
    // Runtime source names/aliases are relative to the caller's stated base,
    // even when an absolute-only authored set inferred a narrower query root.
    const absolute = resolve(base, input.sourceFileName);
    const name = logical(absolute, `additional runtime source '${input.sourceFileName}'`);
    if (claimed.has(absolute)) throw new TypeError(`additional runtime source '${input.sourceFileName}' resolves to a duplicate path`);
    if (Buffer.byteLength(input.source, "utf8") > 2 * 1024 * 1024) {
      throw new TypeError(`additional runtime source '${input.sourceFileName}' exceeds 2097152 bytes`);
    }
    claimed.add(absolute);
    const resolutionAliases: readonly string[] = input.resolutionAliases ?? [];
    const aliases = [...new Set(resolutionAliases.map(alias => resolve(base, alias)))].sort(compare).map(alias => {
      const path = logical(alias, `additional runtime alias '${alias}'`);
      if (claimed.has(alias)) throw new TypeError(`additional runtime alias '${alias}' resolves to a duplicate path`);
      claimed.add(alias);
      return path;
    });
    // The old API treated these modules as TypeScript regardless of the label.
    // Keep that contract explicitly, without a host compiler SourceFile object.
    const path = [".ts", ".tsx", ".mts", ".cts"].includes(extname(name).toLowerCase()) ? name : `${name}.__vibelang_generated__.ts`;
    files.push({path, kind:"typescript", text:input.source});
    runtimeModules.push({path, aliases:path === name ? aliases : [name, ...aliases], compilerData:isCompilerIssuedRuntimeSource(input)});
  }
  return { rootDir:root, paths, request:{files, explicitVibeLangSources:true,
    ...(options.traceDependencies === undefined ? {} : {traceDependencies:options.traceDependencies}),
    ...(runtimeModules.length ? {runtimeModules} : {}),
    ...(existsSync(root) && statSync(root).isDirectory() ? {resolutionRoot:root} : {}),
  } };
}

export function nativeProjectAnalysis(prepared: PreparedNativeProject, result: NativeLanguageAnalysisResult): ProjectAnalysis {
  const { paths } = prepared;
  const nativeFiles = new Map(result.files.map(file => [file.path, file]));
  const analyzed = [...paths].map(([path, entry], index) => {
    const file = nativeFiles.get(path);
    if (!file) throw new Error(`native project analysis omitted ${entry.input.fileName}`);
    // The public per-file table addresses authored sources only. A dependency
    // finding stays visible on the first input with its native identity in the
    // message; do not reread mutable disk bytes to invent line/column metadata.
    const issues = result.diagnostics.filter(issue => issue.file === path ||
      (index === 0 && (issue.file === undefined || !paths.has(issue.file))));
    return {fileName:entry.input.fileName, ...nativeFileAnalysis(file, issues, entry.input.source)};
  });
  const diagnostics = analyzed.flatMap(file => file.diagnostics.map(issue => ({fileName:file.fileName, ...issue})));
  diagnostics.sort((left, right) => compare(left.fileName, right.fileName) || left.start - right.start ||
    compare(left.code, right.code) || compare(left.message, right.message));
  return {files:Object.fromEntries(analyzed.map(file => [file.fileName, file])), diagnostics,
    ...(result.dependencies === undefined ? {} : {dependencies:result.dependencies})};
}
