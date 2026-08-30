import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Analysis, AnalyzeProjectOptions, ProjectDiagnostic, ProjectSource } from "./model.ts";
import { compileSemanticModel, type EffectLowering } from "./compile.ts";
import { buildSemanticProjectModels, NominalErrorIdentities } from "./semantic.ts";

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
   * @see CompileOptions.effectLowering — forwarded verbatim to every module in
   * the project. It is a WHOLE-PROJECT choice and cannot be anything else: the
   * convention a function is emitted in decides how its callers in other
   * modules call it, so two modules of one project compiled under two values
   * would disagree about every cross-module call.
   */
  readonly effectLowering?: EffectLowering;
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
  // ONE assigner across every module, so the nominal Error identity invariant is
  // compile-wide rather than per-file. Both ways the algorithm has lost
  // injectivity were reachable here and only one of them is visible inside a
  // single module: a bound that cut the class name off collided two siblings in
  // ONE file, while a lossy path normalization collided two classes across TWO
  // files. A per-file assigner would have caught only the first.
  const nominalIdentities = new NominalErrorIdentities();
  const emitDiagnostics: ProjectDiagnostic[] = [];
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
      effectLowering: options.effectLowering,
    }, model, { outputBySource, stripImportAttributesForSources, smithersSourceNames, nominalIdentities });
    // The invariant is minted per module by `compileSemanticModel` against the
    // shared assigner above, so lifting it here reports each collision exactly
    // once, keyed by the caller's own file name like every other project row.
    //
    // `SMITHERS1807` joins it for the same structural reason and not by
    // analogy: both are decided during EMIT, so neither exists in
    // `semantic.analysis.diagnostics`, and a project caller that read only that
    // list would compile a refused module and report nothing. Under the default
    // lowering the emitter produces none.
    for (const diagnostic of compiled.analysis.diagnostics) {
      if (diagnostic.code === "SMITHERS1151" || diagnostic.code === "SMITHERS1807") {
        emitDiagnostics.push({ ...diagnostic, fileName: source.fileName });
      }
    }
    files[source.fileName] = {
      fileName: source.fileName,
      absoluteFileName,
      outputFileName,
      code: compiled.code,
      sourceMap: compiled.sourceMap,
      analysis: compiled.analysis,
    };
  }
  return {
    files,
    diagnostics: emitDiagnostics.length === 0
      ? semantic.analysis.diagnostics
      : [...semantic.analysis.diagnostics, ...emitDiagnostics],
  };
}
