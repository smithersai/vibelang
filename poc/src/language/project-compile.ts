import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Analysis, AnalyzeProjectOptions, ProjectDiagnostic, ProjectSource } from "./model.ts";
import { analyzeCompatibilityProject } from "../targets/classify.ts";
import { compileSemanticModel } from "./compile.ts";
import { buildSemanticProjectModels } from "./semantic.ts";

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
   * Emit relative authored `.sm` module specifiers exactly as written rather
   * than rewriting them to the corresponding generated output name. The full
   * cross-module checker pass, row propagation, and every project diagnostic
   * are unchanged; only the emitted specifier text differs. Intended for an
   * external bridge (for example the Go fork's emitter) that owns the final
   * `.sm` -> `.js` rewrite and needs authored text at authored columns.
   * The generated modules are then not directly stock-checkable, so
   * `compileAndCheckProject` is not meaningful with this option.
   */
  readonly preserveSmithersSpecifiers?: boolean;
  /**
   * Additional authored modules which are emitted by a later integration
   * stage. They participate only in relative-import rewriting; Smithers never
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

function sourceOffset(source: string, line: number, column: number): number {
  let currentLine = 1;
  let offset = 0;
  while (currentLine < line && offset < source.length) {
    const code = source.charCodeAt(offset++);
    if (code === 13) {
      if (source.charCodeAt(offset) === 10) offset++;
      currentLine++;
    } else if (code === 10 || code === 0x2028 || code === 0x2029) {
      currentLine++;
    }
  }
  return Math.max(0, Math.min(source.length, offset + Math.max(0, column - 1)));
}

/**
 * Lower a complete supplied `.sm` source set after one cross-module checker
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
  const semantic = buildSemanticProjectModels(sources, options);
  const compatibility = analyzeCompatibilityProject(Object.fromEntries(
    sources.map((source) => [source.fileName, source.source]),
  ));
  const outDir = resolve(options.outDir);
  const extension = options.outputExtension ?? ".ts";
  if (extension !== ".ts" && extension !== ".mjs") {
    throw new TypeError("compileProject outputExtension must be .ts or .mjs");
  }

  if (options.preserveSmithersSpecifiers !== undefined && typeof options.preserveSmithersSpecifiers !== "boolean") {
    throw new TypeError("compileProject preserveSmithersSpecifiers must be a boolean");
  }

  const outputBySource = new Map<string, string>();
  const outputOwners = new Map<string, string>();
  const stripImportAttributesForSources = new Set<string>();
  const smithersSourceNames = new Set<string>();
  for (const source of sources) {
    const absolute = resolve(semantic.rootDir, source.fileName);
    smithersSourceNames.add(absolute);
    const projectPath = relativeInside(semantic.rootDir, absolute, `project source '${source.fileName}'`);
    const output = resolve(outDir, projectPath.replace(/\.sm$/, extension));
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
    const absoluteSource = resolve(semantic.rootDir, mapping.sourceFileName);
    relativeInside(semantic.rootDir, absoluteSource, `runtime source '${mapping.sourceFileName}'`);
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
      const alias = resolve(semantic.rootDir, aliasName);
      relativeInside(semantic.rootDir, alias, `runtime resolution alias '${aliasName}'`);
      const priorAliasOutput = outputBySource.get(alias);
      if (priorAliasOutput !== undefined && priorAliasOutput !== output) {
        throw new TypeError(`runtime resolution alias '${aliasName}' has conflicting outputs`);
      }
      outputBySource.set(alias, output);
      if (mapping.stripImportAttributes) stripImportAttributesForSources.add(alias);
    }
  }

  const files: Record<string, CompiledProjectFile> = {};
  for (const source of [...sources].sort((left, right) => compareText(left.fileName, right.fileName))) {
    const model = semantic.models.get(source.fileName);
    const fileAnalysis = semantic.analysis.files[source.fileName];
    if (!model || !fileAnalysis) throw new TypeError(`project semantic model is missing '${source.fileName}'`);
    const absoluteFileName = resolve(semantic.rootDir, source.fileName);
    const outputFileName = outputBySource.get(absoluteFileName)!;
    const sourceName = relativeInside(semantic.rootDir, absoluteFileName, `project source '${source.fileName}'`)
      .split(sep).join("/");
    const compiled = compileSemanticModel(source.source, {
      fileName: absoluteFileName,
      outputFileName,
      runtimeImport: options.runtimeImport,
      sourceMap: options.sourceMap,
      sourceName,
      preserveSmithersSpecifiers: options.preserveSmithersSpecifiers,
    }, model, { outputBySource, stripImportAttributesForSources, smithersSourceNames });
    files[source.fileName] = {
      fileName: source.fileName,
      absoluteFileName,
      outputFileName,
      code: compiled.code,
      sourceMap: compiled.sourceMap,
      analysis: compiled.analysis,
    };
  }
  const sourcesByPortableName = new Map<string, ProjectSource>();
  for (const source of sources) {
    const normalized = source.fileName.replaceAll("\\", "/");
    sourcesByPortableName.set(normalized, source);
    sourcesByPortableName.set(normalized.replace(/^\/+/, ""), source);
    sourcesByPortableName.set(
      relative(semantic.rootDir, resolve(semantic.rootDir, source.fileName)).split(sep).join("/"),
      source,
    );
  }
  const compatibilityDiagnostics: ProjectDiagnostic[] = compatibility.diagnostics.map((diagnostic) => {
    const source = sourcesByPortableName.get(diagnostic.file.replaceAll("\\", "/"));
    if (!source) {
      throw new TypeError(`portability diagnostic references unknown project file '${diagnostic.file}'`);
    }
    return {
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      fileName: source.fileName,
      start: sourceOffset(source.source, diagnostic.line, diagnostic.column),
      line: diagnostic.line,
      column: diagnostic.column,
    };
  });
  return { files, diagnostics: [...semantic.analysis.diagnostics, ...compatibilityDiagnostics] };
}
