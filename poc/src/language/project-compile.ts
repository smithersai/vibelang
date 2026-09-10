import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Analysis, AnalyzeProjectOptions, ProjectDiagnostic, ProjectSource } from "./model.ts";
import { getNativeCompiler } from "../compiler/native.ts";
import { prepareNativeProject, nativeProjectAnalysis } from "./native-project.ts";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface CompileProjectOptions extends AnalyzeProjectOptions {
  /** Virtual destination root; this API returns code and performs no writes. */
  readonly outDir: string;
  /** Import specifier used by generated runtime helpers. */
  readonly runtimeImport?: string;
  /** Include coarse per-file TypeScript source maps (default true). */
  readonly sourceMap?: boolean;
  /** `.ts` for a TypeScript integration, `.mjs` for a later JS emit pass. */
  readonly outputExtension?: ".ts" | ".mjs";
  /**
   * Emit relative authored `.vibe` module specifiers exactly as written rather
   * than rewriting them to the corresponding generated output name. The full
   * cross-module checker pass, row propagation, and every project diagnostic
   * are unchanged; only the emitted specifier text differs. Intended for an
   * external bridge (for example the Go fork's emitter) that owns the final
   * `.vibe` -> `.js` rewrite and needs authored text at authored columns.
   * The generated modules are then not directly stock-checkable, so
   * `compileAndCheckProject` is not meaningful with this option.
   */
  readonly preserveVibeLangSpecifiers?: boolean;
  /**
   * Additional authored modules which are emitted by a later integration
   * stage. They participate only in relative-import rewriting; VibeLang never
   * parses, lowers, or executes these modules here.
   */
  readonly additionalRuntimeOutputs?: readonly {
    readonly sourceFileName: string;
    readonly outputFileName: string;
    /** Checker-resolved spellings such as `./value.js` -> `value.ts`. */
    readonly resolutionAliases?: readonly string[];
    /** Generated JavaScript targets do not retain authored asset attributes. */
    readonly stripImportAttributes?: boolean;
  }[];
}

export interface CompiledProjectFile {
  readonly fileName: string;
  readonly absoluteFileName: string;
  readonly outputFileName: string;
  readonly code: string;
  readonly sourceMap?: string;
  readonly analysis: Analysis;
}

export interface CompileProjectResult {
  readonly dependencies?: import("../compiler/protocol.ts").NativeDependencyTrace;
  readonly files: Readonly<Record<string, CompiledProjectFile>>;
  readonly diagnostics: readonly ProjectDiagnostic[];
}

function relativeInside(root: string, file: string, label: string): string {
  const path = relative(root, file);
  if (path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new TypeError(`${label} must be a file beneath the project root`);
  }
  return path;
}

/**
 * Lower a complete supplied `.vibe` source set after one cross-module checker
 * pass. Relative authored-module imports target the corresponding output file.
 * No filesystem writes occur and erroneous projects are never claimed valid.
 */
export function compileProject(
  sources: readonly ProjectSource[],
  options: CompileProjectOptions,
): CompileProjectResult {
  if (typeof options?.outDir !== "string" || options.outDir.length === 0) {
    throw new TypeError("compileProject requires outDir");
  }
  const prepared = prepareNativeProject(sources, options);
  const outDir = resolve(options.outDir);
  const extension = options.outputExtension ?? ".ts";
  if (extension !== ".ts" && extension !== ".mjs") {
    throw new TypeError("compileProject outputExtension must be .ts or .mjs");
  }

  if (options.preserveVibeLangSpecifiers !== undefined && typeof options.preserveVibeLangSpecifiers !== "boolean") {
    throw new TypeError("compileProject preserveVibeLangSpecifiers must be a boolean");
  }

  const outputBySource = new Map<string, string>();
  const outputOwners = new Map<string, string>();
  const stripImportAttributesForSources = new Set<string>();
  for (const source of sources) {
    const absolute = resolve(prepared.rootDir, source.fileName);
    const projectPath = relativeInside(prepared.rootDir, absolute, `project source '${source.fileName}'`);
    const output = resolve(outDir, projectPath.replace(/\.vibe$/, extension));
    const prior = outputOwners.get(output);
    if (prior !== undefined) {
      throw new TypeError(`project sources '${prior}' and '${source.fileName}' collide at '${output}'`);
    }
    outputOwners.set(output, source.fileName);
    outputBySource.set(absolute, output);
  }
  for (const mapping of options.additionalRuntimeOutputs ?? []) {
    if (mapping.stripImportAttributes !== undefined && typeof mapping.stripImportAttributes !== "boolean") {
      throw new TypeError(`runtime source '${mapping.sourceFileName}' has an invalid stripImportAttributes policy`);
    }
    const absoluteSource = resolve(prepared.rootDir, mapping.sourceFileName);
    relativeInside(prepared.rootDir, absoluteSource, `runtime source '${mapping.sourceFileName}'`);
    const output = resolve(mapping.outputFileName);
    relativeInside(outDir, output, `runtime output '${mapping.outputFileName}'`);
    const priorSourceOutput = outputBySource.get(absoluteSource);
    if (priorSourceOutput !== undefined && priorSourceOutput !== output) {
      throw new TypeError(`runtime source '${mapping.sourceFileName}' has conflicting outputs`);
    }
    const priorOwner = outputOwners.get(output);
    if (priorOwner !== undefined && priorOwner !== mapping.sourceFileName) {
      throw new TypeError(`project sources '${priorOwner}' and '${mapping.sourceFileName}' collide at '${output}'`);
    }
    outputOwners.set(output, mapping.sourceFileName);
    outputBySource.set(absoluteSource, output);
    if (mapping.stripImportAttributes) stripImportAttributesForSources.add(absoluteSource);
    for (const aliasName of mapping.resolutionAliases ?? []) {
      const alias = resolve(prepared.rootDir, aliasName);
      relativeInside(prepared.rootDir, alias, `runtime resolution alias '${aliasName}'`);
      const priorAliasOutput = outputBySource.get(alias);
      if (priorAliasOutput !== undefined && priorAliasOutput !== output) {
        throw new TypeError(`runtime resolution alias '${aliasName}' has conflicting outputs`);
      }
      outputBySource.set(alias, output);
      if (mapping.stripImportAttributes) stripImportAttributesForSources.add(alias);
    }
  }

  // The native resolver also discovers files through resolutionRoot. Those
  // modules are absent from the explicit source list but still need their
  // runtime destinations; dropping them points emitted imports at source .ts.
  const outputs = [...outputBySource].map(([absolute, outputFileName]) => {
    const path = relative(prepared.rootDir, absolute).split(sep).join("/");
    return {path, outputFileName, sourceName:path,
      stripImportAttributes:stripImportAttributesForSources.has(absolute)};
  });
  const lowered = getNativeCompiler().lowerLanguage({
    project:prepared.request, runtimeImport:options.runtimeImport ?? "../runtime/index.ts", outputs,
    ...(options.preserveVibeLangSpecifiers === undefined ? {} : {preserveVibeLangSpecifiers:options.preserveVibeLangSpecifiers}),
  });
  const analysis = nativeProjectAnalysis(prepared, {...lowered.analysis, diagnostics:[...lowered.analysis.diagnostics, ...lowered.diagnostics]});
  const emitted = new Map(lowered.files.map(file => [file.path, file]));
  const files: Record<string, CompiledProjectFile> = {};
  for (const source of [...sources].sort((left, right) => compareText(left.fileName, right.fileName))) {
    const fileAnalysis = analysis.files[source.fileName];
    if (!fileAnalysis) throw new TypeError(`native project analysis is missing '${source.fileName}'`);
    const absoluteFileName = resolve(prepared.rootDir, source.fileName);
    const outputFileName = outputBySource.get(absoluteFileName)!;
    const sourceName = relativeInside(prepared.rootDir, absoluteFileName, `project source '${source.fileName}'`)
      .split(sep).join("/");
    const compiled = emitted.get(sourceName);
    files[source.fileName] = {
      fileName: source.fileName,
      absoluteFileName,
      outputFileName,
      code: compiled?.text ?? "",
      ...(options.sourceMap === false || !compiled ? {} : {sourceMap:compiled.sourceMap}),
      analysis: fileAnalysis,
    };
  }
  return {
    files,
    diagnostics: analysis.diagnostics,
    ...(analysis.dependencies === undefined ? {} : {dependencies:analysis.dependencies}),
  };
}
