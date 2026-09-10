/**
 * Shared native project pipeline for command-line and build-tool delivery.
 * This module has no CLI startup and no second parser/checker implementation.
 * Filesystem publication remains explicit; parsing, checking and lowering use
 * Go through the same host-side asset/comptime orchestration.
 */
import {
  closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync,
  mkdirSync, mkdtempSync, openSync, readSync, realpathSync, renameSync, rmSync,
  statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getNativeCompiler } from "../poc/dist/compiler/native.js";
import type { NativeDependencyTrace } from "../poc/dist/compiler/protocol.js";
import {
  analyzeProject, checkEmittedProject, composeSourceMaps, compileProject,
  DEFAULT_RUNTIME_IMPORT, emitProjectDeclarations,
} from "../poc/dist/language/index.js";
import {
  AssetCompiler, ComptimeCompiler, compileComptimeIntrinsics,
  compileSourceAssetModules, DEFAULT_SCHEMA_RUNTIME_IMPORT,
  digest as comptimeDigest, type AssetDependency, type ComptimeLoweringProvenance,
} from "../poc/dist/build/index.js";
import { compileDurableModule } from "../poc/dist/durable/module-compiler.js";
import { GoBackendFailure, type GoBackendDiagnostic } from "./go-backend.js";
import { buildRelativeRuntimeGraph, transpileRelativeRuntimeGraph } from "./relative-runtime-graph.js";

export const MAX_CLI_SOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_TEST_PROJECT_BYTES = 16 * 1024 * 1024;
export const MAX_TEST_PROJECT_FILES = 1_024;
export const DEFAULT_VIBELANG_PROJECT_BUDGET = Object.freeze({
  maximumFileBytes: MAX_CLI_SOURCE_BYTES,
  maximumTotalBytes: MAX_TEST_PROJECT_BYTES,
  maximumFiles: MAX_TEST_PROJECT_FILES,
});


export interface CliDiagnostic {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
}

export function rowsNotComputed(stage: string): string {
  return `requirement rows were not computed: the ${stage} stage reported errors before the row analysis ran`;
}

export interface VibeLangFileResult {
  readonly input: string;
  readonly output?: string;
  readonly diagnostics: readonly CliDiagnostic[];
  /**
   * Requirement and checked-failure rows per authored function. Present only
   * when this run actually computed them; see `rowsUnavailable`.
   */
  readonly rows?: Readonly<Record<string, { readonly failures: readonly string[]; readonly requirements: readonly string[] }>>;
  /** Set exactly when `rows` is absent, naming why the rows are unknown. */
  readonly rowsUnavailable?: string;
  readonly declarations?: readonly string[];
  readonly sourceMap?: string;
  readonly assets?: {
    readonly cacheIdentity: string;
    readonly modules: readonly {
      readonly sourceFileName: string;
      readonly outputFileName: string;
      readonly logicalKey: string;
      readonly contentKey: string;
      readonly loader: string;
      readonly cacheHit: boolean;
      readonly dependencies: readonly AssetDependency[];
      /** Logical keys of the generated sibling modules this one imports. */
      readonly references: readonly string[];
      /** 0 for an authored asset request; 1..4 for a loader-declared edge. */
      readonly depth: number;
    }[];
  };
  readonly comptime?: {
    readonly identity: string;
    readonly cacheIdentity: string;
    readonly provenance: ComptimeLoweringProvenance;
    readonly calls: readonly {
      readonly start: number;
      readonly end: number;
      readonly line: number;
      readonly column: number;
      readonly key: string;
      readonly logicalKey: string;
      readonly cacheHit: boolean;
      readonly dependencies: readonly AssetDependency[];
    }[];
  };
}

export interface ProjectBuildPublication {
  readonly rootDir: string;
  readonly outDir: string;
  readonly outputs: readonly { readonly fileName: string; readonly code: string }[];
  /** Foreign modules stay under the bundler's original loader/transforms. */
  readonly modules: readonly {
    readonly kind: "vibelang" | "asset" | "foreign";
    readonly sourceFileName: string;
    readonly outputFileName: string;
  }[];
}

interface LoadedVibeLangProject {
  readonly rootDir: string;
  readonly sources: readonly { readonly fileName: string; readonly source: string }[];
  readonly runtimeSeeds: readonly {
    readonly fileName: string;
    readonly source: string;
    readonly bytes: number;
  }[];
  readonly totalBytes: number;
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isVibeLangFile(file: string): boolean {
  return extname(file).toLowerCase() === ".vibe";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readBoundedUtf8File(fileName: string, maximumBytes: number, description: string, preserveBOM = false): {
  readonly fileName: string;
  readonly source: string;
  readonly bytes: number;
} {
  const absolute = realpathSync(resolve(fileName));
  // Reject streams/devices before reading. Nonblocking/no-follow also protects
  // the final open if a regular file is replaced after canonicalization.
  if (!statSync(absolute).isFile()) throw new TypeError(`${description} must be a regular file`);
  const descriptor = openSync(absolute, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW);
  let bytes: Buffer;
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new TypeError(`${description} must be a regular file`);
    if (metadata.size > maximumBytes) throw new TypeError(`${description} exceeds ${maximumBytes} bytes`);
    const bounded = Buffer.allocUnsafe(maximumBytes + 1);
    let offset = 0;
    while (offset < bounded.byteLength) {
      const count = readSync(descriptor, bounded, offset, bounded.byteLength - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > maximumBytes) throw new TypeError(`${description} exceeds ${maximumBytes} bytes`);
    bytes = bounded.subarray(0, offset);
  } finally {
    closeSync(descriptor);
  }
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: preserveBOM }).decode(bytes);
  } catch {
    throw new TypeError(`${description} is not valid UTF-8`);
  }
  return { fileName: absolute, source, bytes: bytes.byteLength };
}

const CLI_SOURCE_MAP_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const CLI_SOURCE_MAP_VALUES = new Map([...CLI_SOURCE_MAP_BASE64].map((character, index) => [character, index]));

function decodeSourceMapVlq(segment: string, start: number): readonly [number, number] {
  let value = 0;
  let shift = 0;
  let index = start;
  for (;;) {
    if (index >= segment.length || shift > 48) throw new TypeError("invalid CLI source-map VLQ segment");
    const digit = CLI_SOURCE_MAP_VALUES.get(segment[index++]);
    if (digit === undefined) throw new TypeError("invalid CLI source-map base64 digit");
    value += (digit & 31) * 2 ** shift;
    if (!Number.isSafeInteger(value)) throw new TypeError("CLI source-map VLQ exceeds safe integer range");
    if ((digit & 32) === 0) break;
    shift += 5;
  }
  const magnitude = Math.floor(value / 2);
  return [(value & 1) === 1 ? -magnitude : magnitude, index];
}

/**
 * Map one generated position back onto authored coordinates, or report that the
 * map does not anchor it.
 *
 * `undefined` — not a thrown error — is the answer for a generated position the
 * map does not cover. A diagnostic the compiler has already decided to report is
 * not the place to discover that a lowering emitted an unmapped line: throwing
 * there destroys the whole run, so the program is refused with a bare
 * `VIBELANG_PROJECT_ERROR` envelope and NONE of its diagnostics, which is
 * strictly less than the compiler already knew. The conformance JS backend
 * settled this same question the other way years of habit ago
 * (`conformance/runner/backend-js.mjs`, `authoredPosition`: "anything else ... keep
 * the generated position and say so with `mapped: false`"), and the product now
 * matches it. Measured on
 * `02-unwrap-propagation/postfix-bang-in-a-labeled-statement-body-is-accepted`,
 * where the reference's labeled-statement lowering emits TypeScript the stock
 * checker rejects at a generated line the map does not anchor: before this, the
 * CLI answered `diagnostic source map has no mapping for 22:5` and reported no
 * diagnostic at all.
 *
 * Only the unanchored position is softened. A map that names a file outside the
 * project is still a integrity failure and still throws below, because that one
 * says the map itself is describing a different program.
 */
export function originalSourcePosition(sourceMap: string, line: number, column: number): {
  readonly source: string;
  readonly line: number;
  readonly column: number;
} | undefined {
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(column) || line < 0 || column < 0) {
    throw new TypeError("diagnostic has an invalid generated source position");
  }
  if (Buffer.byteLength(sourceMap, "utf8") > 16 * 1024 * 1024) {
    throw new TypeError("diagnostic source map exceeds the CLI limit");
  }
  const parsed: unknown = JSON.parse(sourceMap);
  if (!isRecord(parsed) || parsed.version !== 3 || typeof parsed.mappings !== "string" ||
    !Array.isArray(parsed.sources) || !parsed.sources.every((source) => typeof source === "string") ||
    !Array.isArray(parsed.names) || !parsed.names.every((name) => typeof name === "string") ||
    (parsed.sourceRoot !== undefined && parsed.sourceRoot !== "")) {
    throw new TypeError("diagnostic source map has an unsupported version-3 shape");
  }
  let previousSource = 0;
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  let previousName = 0;
  let selected: {
    readonly generatedColumn: number;
    readonly source: number;
    readonly originalLine: number;
    readonly originalColumn: number;
  } | undefined;
  for (const [generatedLine, encodedLine] of parsed.mappings.split(";").entries()) {
    if (generatedLine === line) selected = undefined;
    let previousGeneratedColumn = 0;
    for (const segment of encodedLine === "" ? [] : encodedLine.split(",")) {
      const values: number[] = [];
      for (let offset = 0; offset < segment.length;) {
        const [value, next] = decodeSourceMapVlq(segment, offset);
        values.push(value);
        offset = next;
      }
      if (values.length !== 1 && values.length !== 4 && values.length !== 5) {
        throw new TypeError("diagnostic source map segment must have one, four, or five fields");
      }
      previousGeneratedColumn += values[0]!;
      if (previousGeneratedColumn < 0) throw new TypeError("diagnostic source map has a negative generated column");
      if (values.length === 1) {
        if (generatedLine === line && previousGeneratedColumn <= column) selected = undefined;
        continue;
      }
      previousSource += values[1]!;
      previousOriginalLine += values[2]!;
      previousOriginalColumn += values[3]!;
      if (values.length === 5) previousName += values[4]!;
      if (
        previousSource < 0 || previousSource >= parsed.sources.length ||
        previousOriginalLine < 0 || previousOriginalColumn < 0 ||
        previousName < 0 || (values.length === 5 && previousName >= parsed.names.length)
      ) throw new TypeError("diagnostic source map contains an out-of-range coordinate");
      if (generatedLine === line && previousGeneratedColumn <= column) {
        selected = {
          generatedColumn: previousGeneratedColumn,
          source: previousSource,
          originalLine: previousOriginalLine,
          originalColumn: previousOriginalColumn,
        };
      }
    }
    if (generatedLine >= line) break;
  }
  if (!selected) return undefined;
  return {
    source: parsed.sources[selected.source] as string,
    line: selected.originalLine,
    column: selected.originalColumn + column - selected.generatedColumn,
  };
}

function remapCliDiagnostic(
  project: LoadedVibeLangProject,
  sourceMap: string,
  diagnostic: CliDiagnostic,
): CliDiagnostic {
  if (diagnostic.line === undefined || diagnostic.column === undefined) return diagnostic;
  const mapped = originalSourcePosition(sourceMap, diagnostic.line - 1, diagnostic.column - 1);
  // The map does not anchor this generated position. Report the diagnostic where
  // the compiler found it rather than dropping the whole run; see
  // `originalSourcePosition`.
  if (!mapped) return diagnostic;
  const source = project.sources.find((candidate) => candidate.fileName === mapped.source);
  if (!source) throw new TypeError(`diagnostic source map references unknown project file '${mapped.source}'`);
  return {
    ...diagnostic,
    file: resolve(project.rootDir, source.fileName),
    line: mapped.line + 1,
    column: mapped.column + 1,
  };
}


/** Resolve existing ancestors so relative imports survive symlinked temp roots. */
export function canonicalFuturePath(file: string): string {
  let ancestor = resolve(file);
  const suffix: string[] = [];
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) return resolve(file);
    suffix.unshift(basename(ancestor));
    ancestor = parent;
  }
  return join(realpathSync(ancestor), ...suffix);
}


function isInside(root: string, file: string): boolean {
  const path = relative(root, file);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

export function commonSourceRoot(files: readonly string[]): string {
  if (files.length === 0) throw new TypeError("at least one .vibe source is required");
  let root = dirname(files[0]);
  while (!files.every((file) => isInside(root, file))) {
    const parent = dirname(root);
    if (parent === root) throw new TypeError(".vibe sources do not share a usable source root");
    root = parent;
  }
  return root;
}

function staticModuleSpecifiers(source: string, fileName: string): readonly string[] {
  const file = getNativeCompiler().inspect([{ path: basename(fileName), text: source, scriptKind: "typescript" }]).files[0]!;
  // Discovery retains its authored top-level scope; mandatory frontend
  // checking, not this recovery walk, owns parser and semantic refusals.
  return file.moduleSyntax.flatMap(item => item.topLevel &&
    (item.kind === "import-declaration" || item.kind === "module-re-export") && item.specifier !== undefined
    ? [item.specifier] : []);
}

function existingFileIdentity(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const canonical = realpathSync(path);
  return statSync(canonical).isFile() ? canonical : undefined;
}

/**
 * Resolve one relative specifier written in a `.vibe` source to the authored
 * VibeLang module it names, or `undefined` when it names something else (a
 * foreign module, a package, a host module).
 *
 * The resolution must be deterministic: the CLI contract requires failing
 * closed when a source "cannot be resolved deterministically", and requires
 * rejecting "aliases that make one file appear under multiple identities".
 * Taking the first candidate that happens to exist satisfies neither, so both
 * ways one specifier can denote two modules are rejected here:
 *
 *   - two VibeLang candidates exist (`./dep` with both `dep.vibe` and
 *     `dep/index.vibe`); and
 *   - a file literally exists at the written path and is not the VibeLang
 *     source the emit-name convention maps it to (`./dep.js` with a real
 *     `dep.js` beside `dep.vibe`). Every other extension already lets the literal
 *     file win and be checked as foreign, so silently preferring `dep.vibe` here
 *     both shadowed a real module and diverged from its own sibling forms.
 */
export function resolveAuthoredVibeLangImport(containingFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const exact = resolve(dirname(containingFile), specifier);
  const candidates: string[] = [];
  if (exact.endsWith(".vibe")) candidates.push(exact);
  else if (extname(exact) === "") candidates.push(`${exact}.vibe`, join(exact, "index.vibe"));
  else if (exact.endsWith(".js")) candidates.push(`${exact.slice(0, -3)}.vibe`);
  const resolved = [...new Set(candidates.map(existingFileIdentity).filter((item) => item !== undefined))];
  if (resolved.length === 0) return undefined;
  if (resolved.length > 1) {
    throw new TypeError(
      `.vibe import ${JSON.stringify(specifier)} in ${containingFile} does not resolve deterministically; ` +
        `it names more than one source: ${resolved.join(", ")}`,
    );
  }
  const authored = resolved[0]!;
  const literal = existingFileIdentity(exact);
  if (literal !== undefined && literal !== authored) {
    throw new TypeError(
      `.vibe import ${JSON.stringify(specifier)} in ${containingFile} is ambiguous; ` +
        `it names the existing file ${literal} and also the VibeLang source ${authored}`,
    );
  }
  return authored;
}

export function loadVibeLangProject(
  inputNames: readonly string[],
  requestedRoot?: string,
  budget: {
    readonly maximumFileBytes: number;
    readonly maximumTotalBytes: number;
    readonly maximumFiles: number;
    readonly preserveBOM?: boolean;
  } = DEFAULT_VIBELANG_PROJECT_BUDGET,
  host: {
    readonly sourceOverrides?: ReadonlyMap<string, string>;
    readonly onDependencies?: (dependencies: NativeDependencyTrace) => void;
  } = {},
): LoadedVibeLangProject {
  const canonicalInputs = inputNames.map((name) => realpathSync(resolve(name)));
  const rootDir = requestedRoot
    ? realpathSync(resolve(requestedRoot))
    : commonSourceRoot(canonicalInputs);
  const pending = [...canonicalInputs];
  const overrides = new Map<string, string>();
  for (const [fileName, source] of host.sourceOverrides ?? []) {
    const absolute = realpathSync(resolve(fileName));
    if (!isVibeLangFile(absolute) || !isInside(rootDir, absolute) || absolute === rootDir ||
      typeof source !== "string" || overrides.has(absolute)) {
      throw new TypeError("project source override must name one distinct .vibe file beneath rootDir");
    }
    if (Buffer.byteLength(source, "utf8") > budget.maximumFileBytes || overrides.size >= budget.maximumFiles) {
      throw new TypeError("project source overrides exceed the source budget");
    }
    overrides.set(absolute, source);
  }
  const sourceByAbsoluteName = new Map<string, { readonly source: string; readonly bytes: number }>();
  const identityOwners = new Map<string, string>();
  let totalBytes = 0;
  while (pending.length > 0) {
    const fileName = pending.pop()!;
    if (sourceByAbsoluteName.has(fileName)) continue;
    if (!isVibeLangFile(fileName)) throw new TypeError(`project source is not .vibe: ${fileName}`);
    if (!isInside(rootDir, fileName) || fileName === rootDir) {
      throw new TypeError(`.vibe source is outside --rootDir: ${fileName}`);
    }
    if (sourceByAbsoluteName.size >= budget.maximumFiles) {
      throw new TypeError(`.vibe project exceeds ${budget.maximumFiles} source files`);
    }
    host.onDependencies?.({ files: [fileName], directories: [] });
    const override = overrides.get(fileName);
    const snapshot = override === undefined
      ? readBoundedUtf8File(fileName, budget.maximumFileBytes, ".vibe source", budget.preserveBOM)
      : { source: override, bytes: Buffer.byteLength(override, "utf8") };
    const source = snapshot.source;
    const metadata = statSync(fileName);
    if (!metadata.isFile()) throw new TypeError(".vibe source must be a regular file");
    const identity = `${metadata.dev}:${metadata.ino}`;
    const priorIdentity = identityOwners.get(identity);
    if (priorIdentity && priorIdentity !== fileName) {
      throw new TypeError(`.vibe project contains hard-link aliases: ${priorIdentity} and ${fileName}`);
    }
    identityOwners.set(identity, fileName);
    totalBytes += snapshot.bytes;
    if (totalBytes > budget.maximumTotalBytes) {
      throw new TypeError(`.vibe project exceeds ${budget.maximumTotalBytes} source bytes`);
    }
    sourceByAbsoluteName.set(fileName, { source, bytes: snapshot.bytes });
    for (const specifier of staticModuleSpecifiers(source, fileName)) {
      const dependency = resolveAuthoredVibeLangImport(fileName, specifier);
      if (dependency) {
        if (!isInside(rootDir, dependency) || dependency === rootDir) {
          throw new TypeError(`.vibe dependency is outside --rootDir: ${dependency}`);
        }
        if (!sourceByAbsoluteName.has(dependency)) pending.push(dependency);
      }
    }
  }
  const absoluteNames = [...sourceByAbsoluteName.keys()].sort(compareText);
  return {
    rootDir,
    sources: absoluteNames.map((absoluteName) => ({
      fileName: relative(rootDir, absoluteName).split(sep).join("/"),
      source: sourceByAbsoluteName.get(absoluteName)!.source,
    })),
    runtimeSeeds: absoluteNames.map((absoluteName) => ({
      fileName: absoluteName,
      source: sourceByAbsoluteName.get(absoluteName)!.source,
      bytes: sourceByAbsoluteName.get(absoluteName)!.bytes,
    })),
    totalBytes,
  };
}

export function sourceAssetCompilerForProject(rootDir: string, target = "node-es2022", onDependency?: (absolutePath: string) => void): {
  readonly cacheIdentity: string;
  readonly cacheDirectory: string;
  readonly compiler: AssetCompiler;
} {
  const cacheIdentity = comptimeDigest({
    schema: "vibelang.cli-source-assets/v1",
    projectRoot: rootDir,
    target,
    frontend: "vibelang-root-cli@1",
  });
  const cacheDirectory = resolve(tmpdir(), "vibelang-source-asset-cache-v1", cacheIdentity);
  return {
    cacheIdentity,
    cacheDirectory,
    compiler: new AssetCompiler({
      root: rootDir,
      onDependency,
      cacheDirectory,
      target,
      options: { frontend: "vibelang-root-cli@1" },
    }),
  };
}

export async function compileVibeLangFiles(
  inputNames: readonly string[],
  options: {
    readonly outDir?: string;
    readonly rootDir?: string;
    readonly emit?: boolean;
    readonly runtimeImport?: string;
    /**
     * Module edge the lowered `comptime(Schema.derive<T>())` call site imports
     * `__vsSchema` from. Only a project that actually derives a schema gains
     * the import, and only the compiler ever writes it.
     */
    readonly schemaRuntimeImport?: string;
    /**
     * The project's tsconfig.json. Accepted so both backend arms take the same
     * shape and neither silently drops it; the reference has already validated
     * it in `readVibeLangProjectConfig` by the time it gets here, where the
     * fork validates it itself over the wire.
     */
    readonly configFile?: { readonly path: string; readonly text: string };
    readonly declaration?: boolean;
    readonly sourceMap?: boolean;
    /** Host target identity visible to comptime/loaders. JavaScript remains
     * ES2022 ESM; downstream bundlers own any final downleveling. */
    readonly target?: string;
    /** Existing authored paths only; supplied bytes win without disk writes. */
    readonly sourceOverrides?: ReadonlyMap<string, string>;
    /** Opt-in native read/probe inventory, reported even on checked refusals. */
    readonly onDependencies?: (dependencies: NativeDependencyTrace) => void;
    /** Replaces filesystem publication with a host-owned atomic destination. */
    readonly publish?: (publication: ProjectBuildPublication) => void;
    /** New delivery surfaces must not silently select the withdrawn body model. */
    readonly durableBodyCompatibility?: boolean;
    readonly sourceBudget?: {
      readonly maximumFileBytes: number;
      readonly maximumTotalBytes: number;
      readonly maximumFiles: number;
    };
  },
): Promise<readonly VibeLangFileResult[]> {
  const target = options.target ?? "node-es2022";
  if (typeof target !== "string" || !target.trim() || target.includes("\0") || target.length > 1024) {
    throw new TypeError("project target must be a bounded non-empty identity");
  }
  const project = loadVibeLangProject(inputNames, options.rootDir, options.sourceBudget, options);
  const outDir = canonicalFuturePath(resolve(options.outDir ?? project.rootDir));
  const vibelangRuntimeOutputs = project.runtimeSeeds.map((source) => ({
    sourceFileName: source.fileName,
    outputFileName: resolve(outDir, relative(project.rootDir, source.fileName).replace(/\.vibe$/, ".mjs")),
  }));
  const onDependency = options.onDependencies === undefined ? undefined : (file: string) => options.onDependencies!({ files: [file], directories: [] });
  const assetContext = sourceAssetCompilerForProject(project.rootDir, target, onDependency);
  const assetCacheIdentity = assetContext.cacheIdentity;
  const assetCacheDirectory = assetContext.cacheDirectory;
  if (isInside(outDir, assetCacheDirectory) || isInside(assetCacheDirectory, outDir)) {
    throw new TypeError(".vibe --outDir must not overlap the compiler-owned source-asset cache");
  }
  const sourceAssets = await compileSourceAssetModules({
    compiler: assetContext.compiler,
    sources: project.sources,
    onDependency,
  });
  options.onDependencies?.({
    files: [...new Set(sourceAssets.modules.flatMap(module => [...module.resolutionAliases,
      ...module.dependencies.map(dependency => dependency.path)].map(file => resolve(project.rootDir, file))))],
    directories: [],
  });
  if (!sourceAssets.ok) {
    const diagnostics = new Map(project.sources.map((source) => [source.fileName, [] as CliDiagnostic[]]));
    for (const assetDiagnostic of sourceAssets.diagnostics) {
      const logicalName = relative(project.rootDir, resolve(assetDiagnostic.fileName)).split(sep).join("/");
      const target = diagnostics.get(logicalName);
      if (!target) throw new TypeError(`source-asset diagnostic references unknown project file '${logicalName}'`);
      target.push({
        code: assetDiagnostic.code,
        severity: assetDiagnostic.severity,
        message: assetDiagnostic.message,
        file: resolve(assetDiagnostic.fileName),
        line: assetDiagnostic.line,
        column: assetDiagnostic.column,
      });
    }
    return project.sources.map((source) => ({
      input: resolve(project.rootDir, source.fileName),
      diagnostics: diagnostics.get(source.fileName)!,
      rowsUnavailable: rowsNotComputed("source-asset"),
      declarations: [],
      assets: { cacheIdentity: assetCacheIdentity, modules: [] },
    }));
  }
  const generatedAssetRuntimeSources = sourceAssets.modules.map((module) => ({
    sourceFileName: resolve(project.rootDir, module.sourceFileName),
    source: module.source,
    outputFileName: resolve(outDir, "__vibelang_assets__", `${module.logicalKey}.mjs`),
    resolutionAliases: module.resolutionAliases.map((alias) => resolve(project.rootDir, alias)),
  }));
  const runtimeGraph = buildRelativeRuntimeGraph({
    rootDir: project.rootDir,
    outDir,
    vibelangSources: project.runtimeSeeds,
    vibelangOutputs: vibelangRuntimeOutputs,
    generatedRuntimeSources: generatedAssetRuntimeSources,
    budget: options.sourceBudget ?? DEFAULT_VIBELANG_PROJECT_BUDGET,
  });
  const generatedAssetNames = new Set(generatedAssetRuntimeSources.map(source => source.sourceFileName));
  options.onDependencies?.({
    files: [...new Set([...runtimeGraph.files, ...runtimeGraph.checkerDependencies, ...runtimeGraph.declarationSources, ...runtimeGraph.stagedAssets]
      .map(file => file.fileName).filter(file => !generatedAssetNames.has(file)))],
    directories: [],
  });
  if (runtimeGraph.diagnostics.length > 0) {
    return project.sources.map((source, index) => ({
      input: resolve(project.rootDir, source.fileName),
      diagnostics: index === 0
        ? runtimeGraph.diagnostics.map((diagnostic): CliDiagnostic => ({
            code: diagnostic.code,
            severity: diagnostic.severity,
            message: diagnostic.message,
            file: diagnostic.fileName,
            line: diagnostic.line,
            column: diagnostic.column,
          }))
        : [],
      rowsUnavailable: rowsNotComputed("runtime-graph"),
      declarations: [],
    }));
  }
  if (options.onDependencies) {
    // Comptime can refuse before runtime lowering runs. Capture the native
    // resolver's inputs first, using issued asset aliases so binary assets are
    // never mistaken for TypeScript disk sources. This provisional analysis
    // is used ONLY for watch dependencies: pre-materialization diagnostics and
    // rows cannot authorize output or replace the later semantic verdict.
    const dependencies = analyzeProject(project.sources, {
      rootDir: project.rootDir, additionalRuntimeSources: sourceAssets.modules, traceDependencies: true,
    }).dependencies;
    if (!dependencies) throw new TypeError("native dependency discovery omitted its trace");
    options.onDependencies(dependencies);
  }
  const cacheIdentity = comptimeDigest({
    schema: "vibelang.cli-comptime-cache/v1",
    projectRoot: project.rootDir,
    target,
    frontend: "vibelang-root-cli@1",
  });
  const cacheDirectory = resolve(tmpdir(), "vibelang-comptime-cache-v1", cacheIdentity);
  if (isInside(outDir, cacheDirectory) || isInside(cacheDirectory, outDir)) {
    throw new TypeError(".vibe --outDir must not overlap the compiler-owned comptime cache");
  }
  // The derived-schema runtime is a package seam exactly like `vibelang/runtime`:
  // generated code names the bare specifier so an installed consumer resolves it,
  // and only an internal caller (run/test) redirects it at the packaged file.
  const emittedSchemaRuntime = options.schemaRuntimeImport ?? DEFAULT_SCHEMA_RUNTIME_IMPORT;
  const comptime = await compileComptimeIntrinsics({
    compiler: new ComptimeCompiler({
      root: project.rootDir,
      onDependency,
      cacheDirectory,
      target,
      options: { frontend: "vibelang-root-cli@1" },
    }),
    sources: Object.fromEntries(project.sources.map((source) => [source.fileName, source.source])),
    schemaRuntimeImport: emittedSchemaRuntime,
  });
  options.onDependencies?.({
    files: [...new Set(comptime.calls.flatMap(call => call.build.dependencies.map(dependency => resolve(project.rootDir, dependency.path))))],
    directories: [],
  });
  if (!comptime.ok || !comptime.loweredFiles) {
    const diagnostics = new Map(project.sources.map((source) => [source.fileName, [] as CliDiagnostic[]]));
    for (const diagnostic of comptime.diagnostics) {
      const target = diagnostics.get(diagnostic.file);
      if (!target) throw new TypeError(`comptime diagnostic references unknown project file '${diagnostic.file}'`);
      target.push({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
        file: resolve(project.rootDir, diagnostic.file),
        line: diagnostic.line,
        column: diagnostic.column,
      });
    }
    return project.sources.map((source) => ({
      input: resolve(project.rootDir, source.fileName),
      diagnostics: diagnostics.get(source.fileName)!,
      rowsUnavailable: rowsNotComputed("comptime"),
      declarations: [],
    }));
  }
  const loweredSources = project.sources.map((source) => {
    const lowered = comptime.loweredFiles![source.fileName];
    if (!lowered) throw new TypeError(`comptime lowering omitted project file '${source.fileName}'`);
    return { fileName: source.fileName, source: lowered.code };
  });
  const materialized = loweredSources.map(source => ({
    source, compiled: (() => {
      if (options.durableBodyCompatibility === false && getNativeCompiler().inspect([
        { path: source.fileName, text: source.source, scriptKind: "typescript" },
      ]).files[0]!.moduleSyntax.some(edge => edge.specifier === "vibelang:flows")) {
        throw new TypeError("This build host does not materialize compatibility-only Flow bodies; use 'vibe plan' for static durable plans.");
      }
      return compileDurableModule(source.source, { fileName: source.fileName,
      sourceOrigin: { text: project.sources.find(authored => authored.fileName === source.fileName)!.source,
        sourceMap: comptime.loweredFiles![source.fileName]!.sourceMap,
        loweringIdentity: comptime.loweredFiles![source.fileName]!.identity },
      });
    })(),
  }));
  if (materialized.some(entry => !entry.compiled.ok)) {
    return materialized.map(({ source, compiled }) => ({
      input: resolve(project.rootDir, source.fileName),
      diagnostics: compiled.ok ? [] : compiled.diagnostics.map(diagnostic => remapCliDiagnostic(
        project, comptime.loweredFiles![source.fileName]!.sourceMap, {
          code: diagnostic.code, severity: "error", message: diagnostic.message,
          file: resolve(project.rootDir, source.fileName), line: diagnostic.line, column: diagnostic.column,
        })),
      rowsUnavailable: rowsNotComputed("durable"),
      declarations: [],
    }));
  }
  const materializedSources = materialized.map(({ source, compiled }) => ({
    fileName: source.fileName, source: compiled.ok ? compiled.code : source.source,
  }));
  const materializedMaps = new Map(materialized.map(({ source, compiled }) => [source.fileName,
    compiled.ok && compiled.sourceMap ? composeSourceMaps(compiled.sourceMap,
      comptime.loweredFiles![source.fileName]!.sourceMap, `${source.fileName}.durable.ts`)
      : comptime.loweredFiles![source.fileName]!.sourceMap,
  ]));
  const emittedRuntime = options.runtimeImport ?? DEFAULT_RUNTIME_IMPORT;
  const compiled = compileProject(materializedSources, {
    rootDir: project.rootDir,
    outDir,
    outputExtension: ".mjs",
    runtimeImport: emittedRuntime,
    additionalRuntimeSources: sourceAssets.modules,
    additionalRuntimeOutputs: runtimeGraph.additionalRuntimeOutputs,
    traceDependencies: options.onDependencies !== undefined,
    // Internal maps are mandatory for authored diagnostic remapping even when
    // the caller did not request a JavaScript map artifact.
    sourceMap: true,
  });
  if (options.onDependencies) {
    if (!compiled.dependencies) throw new TypeError("native project compilation omitted its dependency trace");
    options.onDependencies(compiled.dependencies);
  }
  const compiledFiles = Object.values(compiled.files).map((file) => ({
    ...file,
    code: runtimeGraph.rewriteVibeLangRuntimeCalls(file.code, file.absoluteFileName, file.outputFileName),
  }));
  const vibelangToAuthoredMaps = new Map<string, string>();
  const frontendRefused = compiled.diagnostics.some(diagnostic => diagnostic.severity === "error");
  for (const file of compiledFiles) {
    const lowered = comptime.loweredFiles[file.fileName];
    // Native checked lowering emits nothing on a project-wide refusal. Its
    // diagnostics already address the materialized input, not an output map.
    // A missing map on an accepted project remains an integration failure.
    if (frontendRefused && !file.sourceMap) continue;
    if (!lowered || !file.sourceMap) throw new TypeError(`frontend source map is missing for ${file.fileName}`);
    vibelangToAuthoredMaps.set(file.fileName, composeSourceMaps(
      file.sourceMap,
      materializedMaps.get(file.fileName)!,
      `${file.outputFileName}.comptime.mjs`,
    ));
  }
  const results = new Map<string, VibeLangFileResult>();
  const assetOutputs = new Map(generatedAssetRuntimeSources.map((module) => [
    resolve(module.sourceFileName),
    resolve(module.outputFileName),
  ]));
  for (const file of compiledFiles) {
    results.set(file.fileName, {
      input: file.absoluteFileName,
      output: options.emit === false ? undefined : file.outputFileName,
      diagnostics: file.analysis.diagnostics.map((diagnostic) => remapCliDiagnostic(
        project,
        materializedMaps.get(file.fileName)!,
        {
          code: diagnostic.code,
          severity: diagnostic.severity,
          message: diagnostic.message,
          file: file.absoluteFileName,
          line: diagnostic.line,
          column: diagnostic.column,
        },
      )),
      rows: file.analysis.rows,
      declarations: [],
      sourceMap: options.sourceMap && options.emit !== false ? `${file.outputFileName}.map` : undefined,
      assets: {
        cacheIdentity: assetCacheIdentity,
        modules: sourceAssets.modules.map((module) => ({
          sourceFileName: module.sourceFileName,
          outputFileName: assetOutputs.get(resolve(project.rootDir, module.sourceFileName))!,
          logicalKey: module.logicalKey,
          contentKey: module.contentKey,
          loader: module.loader,
          cacheHit: module.cacheHit,
          dependencies: module.dependencies,
          // A loader-declared nested module edge is part of what the build
          // produced, so the audit report names it rather than hiding it behind
          // a flat module list.
          references: module.references,
          depth: module.depth,
        })),
      },
      comptime: {
        identity: comptime.loweredFiles[file.fileName]!.identity,
        cacheIdentity,
        provenance: comptime.loweredFiles[file.fileName]!.provenance,
        calls: comptime.calls.filter((call) => call.file === file.fileName).map((call) => ({
          start: call.start,
          end: call.end,
          line: call.line,
          column: call.column,
          key: call.build.key,
          logicalKey: call.build.logicalKey,
          cacheHit: call.build.cacheHit,
          dependencies: call.build.dependencies,
        })),
      },
    });
  }
  for (const assetDiagnostic of sourceAssets.diagnostics) {
    const logicalName = relative(project.rootDir, resolve(assetDiagnostic.fileName)).split(sep).join("/");
    const result = results.get(logicalName);
    if (!result) throw new TypeError(`source-asset diagnostic references unknown project file '${logicalName}'`);
    (result.diagnostics as CliDiagnostic[]).push({
      code: assetDiagnostic.code,
      severity: assetDiagnostic.severity,
      message: assetDiagnostic.message,
      file: resolve(assetDiagnostic.fileName),
      line: assetDiagnostic.line,
      column: assetDiagnostic.column,
    });
  }

  const emittedFiles = compiledFiles;
  /**
   * A bare `vibelang/...` specifier only resolves from an installed consumer, so
   * the checker and the declaration emitter are told where the packaged files
   * live. They are told it in *resolution*, and the emitted text is handed to
   * them untouched.
   *
   * This used to be a `replaceAll` of the seam over the whole module before
   * checking, which meant `check` type-checked a program that was never
   * emitted: the substitution could not tell a compiler-written import
   * specifier from an authored string literal or literal type spelled
   * `"vibelang/runtime"`, and `run` — which passes `runtimeImport` and so skipped
   * the rewrite — reached the opposite verdict. It diverged in both directions:
   * `check` refused programs `run` accepted, and, because the substituted path
   * ends in `.js` while the seam does not, a template-literal type over the
   * seam let `check` *accept* a program `run` refused.
   *
   * The map is built the same way on every surface and consumed only by the
   * resolver, so no surface can be checking different bytes than it emits.
   */
  const packagedModules: Readonly<Record<string, string>> = {
    [DEFAULT_RUNTIME_IMPORT]: fileURLToPath(new URL("../poc/dist/runtime/index.js", import.meta.url)),
    [DEFAULT_SCHEMA_RUNTIME_IMPORT]: fileURLToPath(new URL("../poc/dist/build/schema-runtime.js", import.meta.url)),
  };
  /**
   * The declaration emitter reads the checker's resolved path, so a `d.mts` can
   * name a packaged module as a synthesized `import("<absolute>")` type. A
   * published declaration must name the package seam instead of this machine.
   *
   * Scoped to `import(...)` syntax rather than to every occurrence of the path.
   * A written `import ... from "vibelang/runtime"` keeps its own specifier
   * through declaration emit and needs nothing done to it, so the only spans
   * that can carry a resolved path are the synthesized ones — and matching
   * those exactly is what keeps this from reaching an authored string literal
   * or literal type that happens to spell the packaged path. That is the same
   * mistake the checker's seam substitution used to make, one stage later.
   */
  const restorePackageSpecifiers = (code: string): string => {
    let restored = code;
    for (const [seam, packaged] of Object.entries(packagedModules)) {
      for (const resolved of [packaged, packaged.replace(/\.js$/, "")]) {
        restored = restored.replaceAll(
          `import(${JSON.stringify(resolved)})`,
          `import(${JSON.stringify(seam)})`,
        );
      }
    }
    return restored;
  };
  const foreign = transpileRelativeRuntimeGraph(runtimeGraph, { sourceMap: options.sourceMap });
  const declaredRuntimeOutputs = new Set(runtimeGraph.declarationSources.flatMap(file =>
    file.runtimeOutputFileName ? [file.runtimeOutputFileName] : []));
  const checkedForeign = foreign.files.filter(file => !declaredRuntimeOutputs.has(file.outputFileName));
  const declarationSources = runtimeGraph.declarationSources.map(file => ({ fileName: file.outputFileName, code: file.code }));
  for (const diagnostic of foreign.diagnostics) {
    const result = results.values().next().value as VibeLangFileResult | undefined;
    if (result) {
      (result.diagnostics as CliDiagnostic[]).push(formatGoDiagnostic(
        project,
        new Map(foreign.files.map(file => [file.fileName, { fileName: file.fileName, source: file.rewrittenSource }])),
        { ...diagnostic, file: diagnostic.file ?? "<relative runtime graph>" },
      ));
    }
  }

  if (![...results.values()].some((result) =>
    result.diagnostics.some((diagnostic) => diagnostic.severity === "error"))) {
    const validation = checkEmittedProject([
      ...emittedFiles.map((file) => ({
        fileName: file.outputFileName,
        // The emitted bytes, unmodified. Every surface checks what it emits.
        code: file.code,
      })),
      ...checkedForeign.map((file) => ({ fileName: file.outputFileName, code: file.validationCode, configuration: "typescript" as const })),
      ...declarationSources,
    ], { moduleOverrides: packagedModules, onDependencies: options.onDependencies });
    for (const diagnostic of validation) {
      if (diagnostic.category !== "error") continue;
      const output = diagnostic.file ? resolve(diagnostic.file) : undefined;
      const file = output ? emittedFiles.find((candidate) => resolve(candidate.outputFileName) === output) : undefined;
      const foreignFile = output
        ? foreign.files.find((candidate) => resolve(candidate.outputFileName) === output)
        : undefined;
      const result = file ? results.get(file.fileName) : results.values().next().value as VibeLangFileResult | undefined;
      if (result) {
        const formatted: CliDiagnostic = {
          code: diagnostic.code, severity: "error", message: diagnostic.message,
          file: diagnostic.file ?? file?.absoluteFileName ?? foreignFile?.fileName ?? "<project>",
          line: diagnostic.position === undefined ? undefined : diagnostic.position.line + 1,
          column: diagnostic.position === undefined ? undefined : diagnostic.position.character + 1,
        };
        (result.diagnostics as CliDiagnostic[]).push(file
          ? remapCliDiagnostic(project, vibelangToAuthoredMaps.get(file.fileName)!, formatted)
          : foreignFile ? { ...formatted, file: foreignFile.fileName } : formatted);
      }
    }
  }

  let declarationOutputs: readonly { readonly fileName: string; readonly code: string }[] = [];
  if (options.declaration && ![...results.values()].some((result) =>
    result.diagnostics.some((diagnostic) => diagnostic.severity === "error"))) {
    const declarations = emitProjectDeclarations([
      ...emittedFiles.map((file) => ({
        fileName: file.outputFileName,
        code: file.code,
        effects: file.analysis.rows,
      })),
      ...checkedForeign.map((file) => ({
        fileName: file.outputFileName,
        code: file.declarationCode,
      })),
      ...declarationSources,
    ], { moduleOverrides: packagedModules });
    declarationOutputs = declarations.outputs.map((output) => ({
      ...output,
      code: restorePackageSpecifiers(output.code),
    }));
    for (const diagnostic of declarations.diagnostics) {
      if (diagnostic.category !== "error") continue;
      const generated = diagnostic.file ? resolve(diagnostic.file) : undefined;
      const file = generated
        ? emittedFiles.find((candidate) => resolve(candidate.outputFileName) === generated)
        : undefined;
      const foreignFile = generated
        ? foreign.files.find((candidate) => resolve(candidate.outputFileName) === generated)
        : undefined;
      const result = file ? results.get(file.fileName) : results.values().next().value as VibeLangFileResult | undefined;
      if (result) {
        const formatted: CliDiagnostic = {
          code: diagnostic.code, severity: "error", message: diagnostic.message,
          file: file?.absoluteFileName ?? foreignFile?.fileName ?? "<project declaration>",
          line: (diagnostic.position?.line ?? 0) + 1,
          column: (diagnostic.position?.character ?? 0) + 1,
        };
        (result.diagnostics as CliDiagnostic[]).push(file
          ? remapCliDiagnostic(project, vibelangToAuthoredMaps.get(file.fileName)!, formatted)
          : foreignFile ? { ...formatted, file: foreignFile.fileName } : formatted);
      }
    }
    for (const file of emittedFiles) {
      const declarationName = file.outputFileName.replace(/\.mjs$/, ".d.mts");
      const result = results.get(file.fileName)!;
      if (!declarationOutputs.some((output) => resolve(output.fileName) === resolve(declarationName))) {
        (result.diagnostics as CliDiagnostic[]).push({
          code: "VIBELANG_DECLARATION_MISSING",
          severity: "error",
          message: `TypeScript emitted no declaration for ${file.absoluteFileName}`,
          file: file.absoluteFileName,
        });
      } else {
        (result.declarations as string[]).push(declarationName);
      }
    }
    const assetSourceNames = new Set(sourceAssets.modules.map((module) =>
      resolve(project.rootDir, module.sourceFileName)));
    for (const file of foreign.files) {
      const declarationName = file.outputFileName.replace(/\.mjs$/, ".d.mts").replace(/\.cjs$/, ".d.cts");
      if (!declarationOutputs.some((output) => resolve(output.fileName) === resolve(declarationName))) {
        const result = results.values().next().value as VibeLangFileResult | undefined;
        if (result) {
          (result.diagnostics as CliDiagnostic[]).push({
            code: assetSourceNames.has(resolve(file.fileName))
              ? "VIBELANG_ASSET_DECLARATION_MISSING"
              : "VIBELANG_FOREIGN_DECLARATION_MISSING",
            severity: "error",
            message: `TypeScript emitted no declaration for ${file.fileName}`,
            file: file.fileName,
          });
        }
      }
    }
  }

  const transpiled = new Map<string, string>();
  const javascriptMaps = new Map<string, string>();
  if (![...results.values()].some((result) => result.diagnostics.some((diagnostic) => diagnostic.severity === "error"))) {
    for (const file of emittedFiles) {
      const nativePath = `${basename(file.outputFileName)}.ts`;
      const emitted = getNativeCompiler().transpile({
        files: [{ path: nativePath, text: file.code }],
        options: {
          target: "es2022",
          module: "esnext",
          sourceMap: options.sourceMap === true,
          inlineSources: options.sourceMap === true,
        },
      }).files[0]!;
      const result = results.get(file.fileName)!;
      for (const diagnostic of emitted.diagnostics) {
        if (diagnostic.category === "error") {
          const formatted = formatGoDiagnostic(project,
            new Map([[nativePath, { fileName: file.absoluteFileName, source: file.code }]]),
            { ...diagnostic, file: diagnostic.file ?? nativePath });
          (result.diagnostics as CliDiagnostic[]).push(
            remapCliDiagnostic(project, vibelangToAuthoredMaps.get(file.fileName)!, formatted),
          );
        }
      }
      let javascript = emitted.javascript;
      if (options.sourceMap) {
        if (!emitted.sourceMap || !file.sourceMap) {
          (result.diagnostics as CliDiagnostic[]).push({
            code: "VIBELANG_SOURCE_MAP_MISSING",
            severity: "error",
            message: `A source-map stage emitted no map for ${file.absoluteFileName}`,
            file: file.absoluteFileName,
          });
        } else {
          try {
            const lowered = comptime.loweredFiles[file.fileName];
            if (!lowered) throw new TypeError(`comptime source map is missing for ${file.fileName}`);
            // Composition is deliberately staged: VibeLang output -> comptime
            // output -> authored sources, then JavaScript -> that combined map.
            // VibeLang now preserves exact authored positions where provable and
            // token anchors across semantic rewrites; compiler-generated text
            // is explicitly unmapped rather than assigned a false position.
            const vibelangToAuthored = vibelangToAuthoredMaps.get(file.fileName);
            if (!vibelangToAuthored) throw new TypeError(`composed frontend source map is missing for ${file.fileName}`);
            const composed = JSON.parse(composeSourceMaps(
              emitted.sourceMap,
              vibelangToAuthored,
              file.outputFileName,
            )) as { sources: string[] } & Record<string, unknown>;
            if (composed.sources.length === 0) throw new TypeError("composed .vibe source map has no authored sources");
            const authoredByName = new Map(project.sources.map((source) => [
              source.fileName,
              resolve(project.rootDir, source.fileName),
            ]));
            composed.sources = composed.sources.map((source) => {
              const authored = authoredByName.get(source);
              if (!authored) throw new TypeError(`composed .vibe source map references unknown source '${source}'`);
              let display = relative(dirname(file.outputFileName), authored).split(sep).join("/");
              if (!display.startsWith(".")) display = `./${display}`;
              return display;
            });
            javascriptMaps.set(file.fileName, JSON.stringify(composed));
            javascript = `${javascript.replace(/\n?\/\/# sourceMappingURL=.*(?:\r?\n)?$/, "").trimEnd()}\n` +
              `//# sourceMappingURL=${basename(file.outputFileName)}.map\n`;
          } catch (error) {
            (result.diagnostics as CliDiagnostic[]).push({
              code: "VIBELANG_SOURCE_MAP_INVALID",
              severity: "error",
              message: error instanceof Error ? error.message : String(error),
              file: file.absoluteFileName,
            });
          }
        }
      }
      transpiled.set(file.fileName, javascript);
    }
  }

  /**
   * One verdict decides both whether anything is written and whether the
   * report is allowed to name a written file.
   *
   * `output`, `sourceMap`, and `declarations` are filled in as each stage
   * produces its artifact, which is long before the last stage that can refuse
   * the compile has run. A refused compile writes nothing — `commitProjectFiles`
   * below is guarded — so a report that still carries those paths is naming
   * files that do not exist. The Go backend already derives all three from its
   * own final verdict; this is the same guard at the same position.
   */
  const emitRefused = [...results.values()].some((result) =>
    result.diagnostics.some((diagnostic) => diagnostic.severity === "error"));
  if (options.emit !== false && !emitRefused) {
    const emissions: Array<{ readonly fileName: string; readonly code: string }> = [];
    for (const file of Object.values(compiled.files)) {
      emissions.push({ fileName: file.outputFileName, code: transpiled.get(file.fileName)! });
      const sourceMap = javascriptMaps.get(file.fileName);
      if (sourceMap) emissions.push({ fileName: `${file.outputFileName}.map`, code: sourceMap });
    }
    for (const file of foreign.files) {
      emissions.push({ fileName: file.outputFileName, code: file.code });
      if (file.sourceMap) emissions.push({ fileName: `${file.outputFileName}.map`, code: file.sourceMap });
    }
    emissions.push(...declarationOutputs);
    if (options.publish) {
      options.publish({
        rootDir: project.rootDir, outDir, outputs: emissions,
        modules: [
          ...vibelangRuntimeOutputs.map(module => ({ ...module, kind: "vibelang" as const })),
          ...runtimeGraph.files.map(file => ({ sourceFileName: file.fileName, outputFileName: file.outputFileName,
            kind: generatedAssetNames.has(file.fileName) ? "asset" as const : "foreign" as const })),
        ],
      });
    } else {
      commitProjectFiles(outDir, emissions);
    }
  }
  return [...results.values()]
    .map((result): VibeLangFileResult => emitRefused
      ? { ...result, output: undefined, sourceMap: undefined, declarations: [] }
      : result)
    .sort((left, right) => compareText(left.input, right.input));
}

export function authoredLineColumn(source: string, offset: number): { readonly line: number; readonly column: number } {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length) {
    throw new GoBackendFailure(
      "VIBELANG_GO_PROTOCOL",
      `The Go compiler returned an out-of-range authored diagnostic offset ${offset}. ` +
      "Remedy: run `npm run build` to rebuild the CLI and Go request producer together.",
    );
  }
  // Native spans and JS indices both use UTF-16 code units. Honor every
  // TypeScript line terminator, treating CRLF as one newline, without parsing.
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index++) {
    const unit = source.charCodeAt(index);
    if (unit === 13) {
      if (source.charCodeAt(index + 1) === 10) {
        if (index + 1 >= offset) continue;
        index++;
      }
    } else if (unit !== 10 && unit !== 0x2028 && unit !== 0x2029) continue;
    line++;
    lineStart = index + 1;
  }
  return { line, column: offset - lineStart + 1 };
}

export function formatGoDiagnostic(
  project: LoadedVibeLangProject,
  byLogicalName: ReadonlyMap<string, { readonly fileName: string; readonly source: string }>,
  diagnostic: GoBackendDiagnostic,
): CliDiagnostic {
  const source = diagnostic.file ? byLogicalName.get(diagnostic.file) : undefined;
  const position = source && diagnostic.span
    ? authoredLineColumn(source.source, diagnostic.span.start)
    : undefined;
  return {
    code: diagnostic.code,
    severity: diagnostic.category === "error" ? "error" : "warning",
    message: diagnostic.message,
    file: source
      ? resolve(project.rootDir, source.fileName)
      : diagnostic.file,
    line: position?.line,
    column: position?.column,
  };
}


export function commitProjectFiles(
  outDir: string,
  filesToWrite: readonly { readonly fileName: string; readonly code: string }[],
): void {
  const root = resolve(outDir);
  mkdirSync(root, { recursive: true });
  const rootMetadata = lstatSync(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new TypeError(`compiler outDir must be a real directory: ${root}`);
  }
  const staging = mkdtempSync(join(dirname(root), ".vibelang-emit-"));
  const staged: Array<{ readonly temporary: string; readonly final: string }> = [];
  const destinations = new Set<string>();
  try {
    for (const file of filesToWrite) {
      const final = resolve(file.fileName);
      if (!isInside(root, final) || final === root) {
        throw new TypeError(`compiler output escapes outDir: ${final}`);
      }
      if (destinations.has(final)) throw new TypeError(`duplicate compiler output: ${final}`);
      destinations.add(final);
      const path = relative(root, final);
      const temporary = resolve(staging, path);
      if (!isInside(staging, temporary)) throw new TypeError(`invalid staged compiler output: ${path}`);
      mkdirSync(dirname(temporary), { recursive: true });
      writeFileSync(temporary, file.code, { flag: "wx" });
      staged.push({ temporary, final });
    }
    // A lexical containment check is insufficient: `root/nested` could be a
    // pre-existing symlink to an ambient filesystem location. Validate and
    // create every parent before the first rename so an ordinary bad path
    // cannot produce a partially committed project or escape --outDir.
    for (const file of staged) {
      const destinationParent = dirname(file.final);
      const parentPath = relative(root, destinationParent);
      let cursor = root;
      for (const part of parentPath === "" ? [] : parentPath.split(sep)) {
        if (part === "" || part === "." || part === "..") {
          throw new TypeError(`invalid compiler output parent: ${destinationParent}`);
        }
        cursor = join(cursor, part);
        if (!existsSync(cursor)) mkdirSync(cursor);
        const metadata = lstatSync(cursor);
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
          throw new TypeError(`compiler output parent must be a real directory: ${cursor}`);
        }
      }
      const canonicalParent = realpathSync(destinationParent);
      const canonicalRoot = realpathSync(root);
      if (!isInside(canonicalRoot, canonicalParent)) {
        throw new TypeError(`compiler output parent escapes outDir: ${destinationParent}`);
      }
      if (existsSync(file.final) && lstatSync(file.final).isSymbolicLink()) {
        throw new TypeError(`compiler output may not replace a symbolic link: ${file.final}`);
      }
    }
    for (const file of staged) {
      renameSync(file.temporary, file.final);
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
