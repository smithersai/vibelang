import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { getNativeCompiler } from "../poc/dist/compiler/native.js";
import type { NativeDiagnostic, NativeRuntimeModuleEdge, NativeRuntimeModuleFile } from "../poc/dist/compiler/protocol.js";

export interface RuntimeSourceBudget {
  readonly maximumFileBytes: number;
  readonly maximumTotalBytes: number;
  readonly maximumFiles: number;
}

export interface RuntimeGraphSeed {
  readonly fileName: string;
  readonly source: string;
  readonly bytes: number;
}

export interface RuntimeOutputReservation {
  readonly sourceFileName: string;
  readonly outputFileName: string;
}

/** Compiler-owned, in-memory runtime source. The caller has already validated issuance. */
export interface GeneratedRuntimeSource {
  readonly sourceFileName: string;
  readonly source: string;
  readonly outputFileName: string;
  readonly resolutionAliases: readonly string[];
}

export interface RelativeRuntimeFile {
  readonly fileName: string;
  readonly displayName: string;
  readonly source: string;
  readonly rewrittenSource: string;
  readonly outputFileName: string;
  readonly format: "esm" | "cjs";
  readonly resolutionAliases: readonly string[];
}

/**
 * One project file this walk reached and read, addressed the way a backend that
 * builds its own program needs it: the canonical path, the project-relative name,
 * and the authored bytes. No output is implied — a staged source is an *input*
 * another compiler has to be told about, not something this graph will emit.
 */
export interface StagedProjectSource {
  readonly fileName: string;
  readonly displayName: string;
  readonly source: string;
}

export interface RelativeRuntimeGraph {
  readonly files: readonly RelativeRuntimeFile[];
  /** Fail-closed trust failures for statically evaluated foreign modules. */
  readonly diagnostics: readonly RuntimeGraphDiagnostic[];
  /**
   * Foreign sources the checker must see but the runtime never loads: a
   * `import type` edge, and any `.d.ts`/`.ts` reached only through one. They
   * carry no output and no initialization trust obligation, which is why they
   * are absent from `files` — but a backend that assembles its own program must
   * still be handed them or the type they name resolves to nothing.
   */
  readonly checkerDependencies: readonly StagedProjectSource[];
  /** Captured declaration companions and their transitive type dependencies.
   * They describe imported runtime modules; erased JavaScript is not a second
   * source implementation to type-check against the consumer's strict options.
   */
  readonly declarationSources: readonly {
    readonly fileName: string;
    readonly outputFileName: string;
    readonly code: string;
    readonly runtimeOutputFileName?: string;
  }[];
  /**
   * Non-code project files a VibeLang source named as an asset, present only
   * when the caller asked for `assetSpecifiers: "stage"`. See that option.
   */
  readonly stagedAssets: readonly StagedProjectSource[];
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly additionalRuntimeOutputs: readonly {
    readonly sourceFileName: string;
    readonly outputFileName: string;
    readonly resolutionAliases: readonly string[];
    readonly stripImportAttributes?: boolean;
  }[];
  /** Rewrite literal dynamic imports which survive VibeLang's static-import pass. */
  readonly rewriteVibeLangRuntimeCalls: (
    code: string,
    authoredFileName: string,
    outputFileName: string,
  ) => string;
}

export interface RuntimeGraphDiagnostic {
  readonly code: "VIBE1510";
  readonly severity: "error";
  readonly message: string;
  readonly fileName: string;
  readonly line: number;
  readonly column: number;
}

export interface TranspiledRuntimeFile extends RelativeRuntimeFile {
  readonly code: string;
  readonly sourceMap?: string;
  /** Virtual checker input; runtime bytes are still `code`. */
  readonly validationCode: string;
  /** Type-preserving input used by the declaration emitter. */
  readonly declarationCode: string;
}

export interface TranspiledRuntimeGraph {
  readonly files: readonly TranspiledRuntimeFile[];
  readonly diagnostics: readonly NativeDiagnostic[];
}

type ModuleEdge = NativeRuntimeModuleEdge;

interface LoadedForeignFile {
  readonly fileName: string;
  readonly displayName: string;
  readonly source: string;
  readonly outputFileName: string;
  readonly format: "esm" | "cjs";
  readonly edges: readonly ResolvedEdge[];
  readonly aliases: Set<string>;
}

interface ResolvedEdge extends ModuleEdge {
  readonly targetFileName?: string;
  readonly targetOutputFileName?: string;
}

const FOREIGN_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const DECLARATION_PATTERN = /\.d\.(?:ts|mts|cts)$/i;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isInside(root: string, file: string): boolean {
  const path = relative(root, file);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function displayPath(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}

function extensionOf(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".d.mts")) return ".d.mts";
  if (lower.endsWith(".d.cts")) return ".d.cts";
  if (lower.endsWith(".d.ts")) return ".d.ts";
  return extname(lower);
}

function formatOf(fileName: string): "esm" | "cjs" {
  const extension = extensionOf(fileName);
  return extension === ".cts" || extension === ".cjs" || extension === ".d.cts" ? "cjs" : "esm";
}

function outputExtension(fileName: string): ".mjs" | ".cjs" {
  return formatOf(fileName) === "cjs" ? ".cjs" : ".mjs";
}

function readBoundedUtf8(fileName: string, maximumBytes: number): {
  readonly source: string;
  readonly bytes: number;
  readonly dev: number;
  readonly ino: number;
} {
  if (lstatSync(fileName).isSymbolicLink()) {
    throw new TypeError(`relative runtime dependency may not be a symbolic link: ${fileName}`);
  }
  const descriptor = openSync(fileName, "r");
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new TypeError(`relative runtime dependency must be a regular file: ${fileName}`);
    if (metadata.size > maximumBytes) {
      throw new TypeError(`relative runtime dependency exceeds ${maximumBytes} bytes: ${fileName}`);
    }
    const buffer = Buffer.allocUnsafe(maximumBytes + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const count = readSync(descriptor, buffer, offset, buffer.byteLength - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > maximumBytes) {
      throw new TypeError(`relative runtime dependency exceeds ${maximumBytes} bytes: ${fileName}`);
    }
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset));
    } catch {
      throw new TypeError(`relative runtime dependency is not valid UTF-8: ${fileName}`);
    }
    return { source, bytes: offset, dev: metadata.dev, ino: metadata.ino };
  } finally {
    closeSync(descriptor);
  }
}

/** Native syntax and conservative trust facts; mandatory frontend checking
 * still owns parse diagnostics. Source recovery here never certifies a module. */
function runtimeModuleFacts(
  source: string,
  fileName: string,
  deferComputedDynamicSpecifier = false,
  rootDir?: string,
): NativeRuntimeModuleFile {
  const path = rootDir === undefined ? `module${extensionOf(fileName)}` : displayPath(rootDir, fileName);
  const result = getNativeCompiler().runtimeModules({
    files: [{ path, text: source, deferComputedDynamicSpecifier }],
    ...(rootDir === undefined ? {} : { resolutionRoot: rootDir }),
  }).files[0]!;
  const diagnostic = result.diagnostics[0];
  if (diagnostic) throw new TypeError(`${fileName}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.message}`);
  return result;
}

function scanEmittedEdges(source: string, fileName: string): readonly ModuleEdge[] {
  return runtimeModuleFacts(source, fileName).edges;
}

function resolveVibeLangSpecifier(containingFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const exact = resolve(dirname(containingFile), specifier);
  const candidates: string[] = [];
  if (exact.endsWith(".vibe")) candidates.push(exact);
  else if (extname(exact) === "") candidates.push(`${exact}.vibe`, resolve(exact, "index.vibe"));
  else if (exact.endsWith(".js")) candidates.push(`${exact.slice(0, -3)}.vibe`);
  const match = candidates.find((candidate) => existsSync(candidate));
  return match ? realpathSync(match) : undefined;
}

function rewriteLiterals(source: string, replacements: readonly {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}[]): string {
  let rewritten = source;
  let previousStart = source.length + 1;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    if (replacement.end > previousStart || replacement.start < 0 || replacement.end > source.length) {
      throw new TypeError("relative runtime rewrite contains overlapping or invalid spans");
    }
    rewritten = `${rewritten.slice(0, replacement.start)}${JSON.stringify(replacement.text)}${rewritten.slice(replacement.end)}`;
    previousStart = replacement.start;
  }
  return rewritten;
}

function relativeSpecifier(fromOutput: string, toOutput: string): string {
  let specifier = relative(dirname(fromOutput), toOutput).split(sep).join("/");
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) specifier = `./${specifier}`;
  return specifier;
}

function collisionKey(fileName: string): string {
  return process.platform === "win32" || process.platform === "darwin" ? fileName.toLowerCase() : fileName;
}

/**
 * Discover and resolve the bounded relative runtime graph without evaluating
 * authored modules. Type-only edges are intentionally not staged.
 */
export function buildRelativeRuntimeGraph(options: {
  readonly rootDir: string;
  readonly outDir: string;
  readonly vibelangSources: readonly RuntimeGraphSeed[];
  readonly vibelangOutputs: readonly RuntimeOutputReservation[];
  readonly generatedRuntimeSources?: readonly GeneratedRuntimeSource[];
  /**
   * What to do with a relative specifier a VibeLang source spells as an asset.
   *
   * `"reject"` (the default) is the reference path: it compiles assets *before*
   * this walk and hands the results in as `generatedRuntimeSources`, so by the
   * time an asset specifier reaches `resolveEdge` it already resolves to a
   * generated module. Anything still unresolved there is a genuinely missing
   * import and must fail.
   *
   * `"stage"` is for a backend that runs its own asset pass over the raw bytes
   * and therefore has no generated modules to hand in. The specifier is not
   * resolved as code; the file behind it is read and reported in
   * `stagedAssets`, and a specifier naming nothing readable is left alone
   * rather than refused, because deciding whether a missing or unreadable asset
   * is an error belongs to that backend's own asset pass, which reports it
   * against the import site instead of aborting the whole project.
   */
  readonly assetSpecifiers?: "reject" | "stage";
  readonly budget: RuntimeSourceBudget;
}): RelativeRuntimeGraph {
  const rootDir = realpathSync(resolve(options.rootDir));
  const outDir = resolve(options.outDir);
  const nativeFacts = new Map<string, {
    readonly source: string;
    readonly deferred: boolean;
    readonly file: NativeRuntimeModuleFile;
    readonly resolutions: ReadonlyMap<string, NativeRuntimeModuleFile["resolutions"][number]>;
  }>();
  const factsFor = (source: string, fileName: string, deferred = false): NativeRuntimeModuleFile => {
    const existing = nativeFacts.get(fileName);
    if (existing) {
      if (existing.source !== source || existing.deferred !== deferred) {
        throw new TypeError(`runtime module changed after its syntax was captured: ${fileName}`);
      }
      return existing.file;
    }
    const file = runtimeModuleFacts(source, fileName, deferred, rootDir);
    nativeFacts.set(fileName, { source, deferred, file,
      resolutions: new Map(file.resolutions.map(item => [item.specifier, item])) });
    return file;
  };
  const scanEdges = (source: string, fileName: string, deferred = false): readonly ModuleEdge[] =>
    factsFor(source, fileName, deferred).edges;
  const hasLeadingModuleNoThrowMarker = (source: string, fileName: string): boolean =>
    factsFor(source, fileName).leadingNoThrow;
  const resolveForeignSpecifier = (containingFile: string, specifier: string, preferTypes = false): {
    readonly canonical: string; readonly alias: string;
  } | undefined => {
    if (!specifier.startsWith(".")) return undefined;
    const alias = resolve(dirname(containingFile), specifier);
    if (!isInside(rootDir, alias)) {
      throw new TypeError(`relative ${preferTypes ? "checker" : "runtime"} dependency is outside the project root: ${alias}`);
    }
    const answer = nativeFacts.get(containingFile)?.resolutions.get(specifier);
    if (!answer) throw new TypeError(`runtime module resolution was not captured: ${containingFile}: ${specifier}`);
    if (answer.message !== "") throw new TypeError(`${containingFile}: ${answer.message}`);
    const target = preferTypes ? answer.typePath : answer.runtimePath;
    return target === undefined ? undefined : {
      canonical: resolve(rootDir, target), alias,
    };
  };
  const vibelangByName = new Map(options.vibelangSources.map((source) => [resolve(source.fileName), source]));
  let totalBytes = options.vibelangSources.reduce((total, source) => total + source.bytes, 0);
  let fileCount = options.vibelangSources.length;
  if (fileCount > options.budget.maximumFiles || totalBytes > options.budget.maximumTotalBytes) {
    throw new TypeError("relative runtime project exceeds its source budget");
  }

  const identityOwners = new Map<string, string>();
  for (const source of options.vibelangSources) {
    const absolute = resolve(source.fileName);
    const metadata = statSync(absolute);
    const identity = `${metadata.dev}:${metadata.ino}`;
    const prior = identityOwners.get(identity);
    if (prior && prior !== absolute) {
      throw new TypeError(`project sources are hard-link aliases of one file: ${prior} and ${absolute}`);
    }
    identityOwners.set(identity, absolute);
  }

  const outputOwners = new Map<string, string>();
  for (const reservation of options.vibelangOutputs) {
    const output = resolve(reservation.outputFileName);
    const key = collisionKey(output);
    const prior = outputOwners.get(key);
    if (prior) throw new TypeError(`runtime outputs collide: ${prior} and ${reservation.sourceFileName}`);
    outputOwners.set(key, reservation.sourceFileName);
  }

  const generatedByName = new Map<string, RelativeRuntimeFile>();
  const generatedByAlias = new Map<string, RelativeRuntimeFile>();
  const generatedEdges = new Map<string, readonly ModuleEdge[]>();
  for (const [index, generated] of (options.generatedRuntimeSources ?? []).entries()) {
    if (
      generated === null || typeof generated !== "object" ||
      typeof generated.sourceFileName !== "string" || generated.sourceFileName.trim() === "" ||
      typeof generated.source !== "string" ||
      typeof generated.outputFileName !== "string" || generated.outputFileName.trim() === "" ||
      !Array.isArray(generated.resolutionAliases) ||
      !generated.resolutionAliases.every((alias) => typeof alias === "string" && alias.trim() !== "")
    ) {
      throw new TypeError(`compiler-generated runtime source ${index} has an invalid shape`);
    }
    const sourceFileName = resolve(rootDir, generated.sourceFileName);
    if (!isInside(rootDir, sourceFileName) || sourceFileName === rootDir) {
      throw new TypeError(`compiler-generated runtime source escapes the project root: ${generated.sourceFileName}`);
    }
    if (
      existsSync(sourceFileName) || vibelangByName.has(sourceFileName) ||
      generatedByName.has(sourceFileName) || generatedByAlias.has(sourceFileName)
    ) {
      throw new TypeError(`compiler-generated runtime source collides with a project path: ${sourceFileName}`);
    }
    if (!hasLeadingModuleNoThrowMarker(generated.source, sourceFileName)) {
      throw new TypeError(`compiler-generated runtime source lacks its no-panic marker: ${sourceFileName}`);
    }
    // A nested loader graph is the one shape allowed to carry an edge: the
    // loader declared it through the tracked dependency context, so the only
    // legal target is a sibling generated module in this same batch. Targets
    // are reconciled after every generated identity is registered, because a
    // sibling may be issued later in the list.
    const edges = scanEdges(generated.source, sourceFileName);
    for (const edge of edges) {
      if (edge.kind !== "import" || edge.typeOnly || !edge.specifier.startsWith(".")) {
        throw new TypeError(
          `compiler-generated asset modules may only import a sibling generated module: ${sourceFileName}`,
        );
      }
    }
    generatedEdges.set(sourceFileName, edges);
    const outputFileName = resolve(generated.outputFileName);
    if (!isInside(outDir, outputFileName) || outputFileName === outDir || extname(outputFileName) !== ".mjs") {
      throw new TypeError(`compiler-generated runtime output must be one .mjs file beneath outDir: ${outputFileName}`);
    }
    const outputKey = collisionKey(outputFileName);
    const priorOutput = outputOwners.get(outputKey);
    if (priorOutput !== undefined) {
      throw new TypeError(`runtime outputs collide: ${priorOutput} and ${sourceFileName}`);
    }
    const aliases = [...new Set(generated.resolutionAliases.map((alias) => resolve(rootDir, alias)))].sort(compareText);
    if (aliases.length !== generated.resolutionAliases.length) {
      throw new TypeError(`compiler-generated runtime source ${sourceFileName} contains duplicate aliases`);
    }
    for (const alias of aliases) {
      if (!isInside(rootDir, alias) || alias === rootDir || alias === sourceFileName) {
        throw new TypeError(`compiler-generated runtime alias escapes or aliases its generated identity: ${alias}`);
      }
      if (vibelangByName.has(alias) || generatedByName.has(alias) || generatedByAlias.has(alias)) {
        throw new TypeError(`compiler-generated runtime alias conflicts with another project identity: ${alias}`);
      }
    }
    const sourceBytes = Buffer.byteLength(generated.source, "utf8");
    if (sourceBytes > options.budget.maximumFileBytes) {
      throw new TypeError(`compiler-generated runtime source exceeds ${options.budget.maximumFileBytes} bytes: ${sourceFileName}`);
    }
    fileCount += 1;
    totalBytes += sourceBytes;
    if (fileCount > options.budget.maximumFiles || totalBytes > options.budget.maximumTotalBytes) {
      throw new TypeError("relative runtime project exceeds its source budget after generated asset modules");
    }
    outputOwners.set(outputKey, sourceFileName);
    const file: RelativeRuntimeFile = {
      fileName: sourceFileName,
      displayName: displayPath(rootDir, sourceFileName),
      source: generated.source,
      rewrittenSource: generated.source,
      outputFileName,
      format: "esm",
      resolutionAliases: aliases,
    };
    generatedByName.set(sourceFileName, file);
    for (const alias of aliases) generatedByAlias.set(alias, file);
  }

  // Reconcile the nested generated graph now that every identity is known, then
  // restate each sibling edge against the emitted output layout. Both ends live
  // beneath the same generated output directory, so this is a pure extension
  // rewrite that keeps the module's authored offsets intact.
  const generatedReferences = new Map<string, readonly string[]>();
  for (const [sourceFileName, edges] of generatedEdges) {
    const file = generatedByName.get(sourceFileName)!;
    const references: string[] = [];
    const replacements = edges.map((edge) => {
      const target = generatedByName.get(resolve(dirname(sourceFileName), edge.specifier));
      if (!target) {
        throw new TypeError(
          `compiler-generated asset module references an unissued generated module: ${sourceFileName} -> ${edge.specifier}`,
        );
      }
      if (target.fileName === sourceFileName) {
        throw new TypeError(`compiler-generated asset module imports itself: ${sourceFileName}`);
      }
      references.push(target.fileName);
      return {
        start: edge.start,
        end: edge.end,
        text: relativeSpecifier(file.outputFileName, target.outputFileName),
      };
    });
    generatedReferences.set(sourceFileName, references);
    const rewritten: RelativeRuntimeFile = {
      ...file,
      rewrittenSource: rewriteLiterals(file.source, replacements),
    };
    generatedByName.set(sourceFileName, rewritten);
    for (const alias of file.resolutionAliases) generatedByAlias.set(alias, rewritten);
  }
  // A cycle between generated modules would evaluate a const binding in its
  // temporal dead zone, so reject it here rather than emit a program that
  // throws on load.
  const generatedVisited = new Map<string, "visiting" | "done">();
  const visitGenerated = (fileName: string, path: readonly string[]): void => {
    const state = generatedVisited.get(fileName);
    if (state === "done") return;
    if (state === "visiting") {
      throw new TypeError(`compiler-generated asset modules form an import cycle: ${[...path, fileName].join(" -> ")}`);
    }
    generatedVisited.set(fileName, "visiting");
    for (const reference of generatedReferences.get(fileName) ?? []) visitGenerated(reference, [...path, fileName]);
    generatedVisited.set(fileName, "done");
  };
  for (const fileName of [...generatedByName.keys()].sort(compareText)) visitGenerated(fileName, []);

  const pendingRuntime = new Set<string>();
  const pendingChecker = new Set<string>();
  const checkerOnlyFiles = new Set<string>();
  const snapshots = new Map<string, ReturnType<typeof readBoundedUtf8>>();
  const foreignByName = new Map<string, LoadedForeignFile>();
  const staticInitializationRoots = new Set<string>();
  const targetAliases = new Map<string, Set<string>>();
  const resolvedOutputByAlias = new Map<string, string>();
  const stagedAssetByName = new Map<string, StagedProjectSource>();
  const pairedDeclarations = new Map<string, string>();
  const checkerEdges = new Map<string, readonly ResolvedEdge[]>();

  /**
   * Read one asset the caller asked to have staged, or decline.
   *
   * Declining is the fail-closed answer, not a shrug: the caller only reaches
   * here with `assetSpecifiers: "stage"`, which means it has an asset pass of
   * its own that reports a missing, unreadable, escaping, or over-budget asset
   * against the import site. Aborting the whole project here would replace that
   * located diagnostic with a thrown project error.
   */
  const reserveAsset = (canonical: string): void => {
    if (stagedAssetByName.has(canonical)) return;
    if (!isInside(rootDir, canonical) || canonical === rootDir) return;
    if (vibelangByName.has(canonical) || generatedByName.has(canonical) || generatedByAlias.has(canonical)) {
      throw new TypeError(`relative asset dependency conflicts with a project code identity: ${canonical}`);
    }
    if (foreignByName.has(canonical) || pendingRuntime.has(canonical) ||
      pendingChecker.has(canonical) || checkerOnlyFiles.has(canonical)) {
      throw new TypeError(`relative dependency is loaded both as code and as an asset: ${canonical}`);
    }
    let snapshot: ReturnType<typeof readBoundedUtf8>;
    try {
      if (!existsSync(canonical) || lstatSync(canonical).isSymbolicLink()) return;
      snapshot = readBoundedUtf8(canonical, options.budget.maximumFileBytes);
    } catch {
      // Unreadable, over budget, or not UTF-8 — the wire protocol carries text,
      // so there is nothing to stage. The importing backend still sees the
      // import and refuses it there.
      return;
    }
    if (fileCount >= options.budget.maximumFiles) return;
    if (totalBytes + snapshot.bytes > options.budget.maximumTotalBytes) return;
    fileCount += 1;
    totalBytes += snapshot.bytes;
    stagedAssetByName.set(canonical, {
      fileName: canonical,
      displayName: displayPath(rootDir, canonical),
      source: snapshot.source,
    });
  };

  /**
   * True when a VibeLang source spelled this edge as an asset rather than as code.
   *
   * Project code is never an asset however it is spelled, so `.vibe`, a foreign
   * source extension, and a declaration file are all excluded before the two
   * asset spellings are considered — an extensionless specifier included, since
   * that is how a `.vibe` sibling is named. Getting that order wrong classified
   * `./helper.vibe` as an asset, because `.vibe` is not a *foreign* extension.
   */
  const namesAnAsset = (edge: ModuleEdge, literal: string): boolean => {
    if (options.assetSpecifiers !== "stage") return false;
    const extension = extensionOf(literal);
    if (extension === "" || extension === ".vibe" || DECLARATION_PATTERN.test(literal)) return false;
    if (FOREIGN_EXTENSIONS.has(extension)) return edge.attributes;
    return true;
  };

  const reserveForeign = (canonical: string, alias: string): string => {
    if (!isInside(rootDir, canonical) || canonical === rootDir) {
      throw new TypeError(`relative runtime dependency is outside the project root: ${canonical}`);
    }
    if (stagedAssetByName.has(canonical)) {
      throw new TypeError(`relative dependency is loaded both as code and as an asset: ${canonical}`);
    }
    const extension = extensionOf(canonical);
    if (generatedByAlias.has(alias) || generatedByName.has(canonical)) {
      throw new TypeError(`relative runtime dependency conflicts with a compiler-generated asset identity: ${alias}`);
    }
    if (DECLARATION_PATTERN.test(canonical)) {
      throw new TypeError(`runtime import resolves only to a declaration file: ${canonical}`);
    }
    if (!FOREIGN_EXTENSIONS.has(extension)) {
      throw new TypeError(`unsupported relative runtime dependency '${canonical}' (${extension || "no extension"})`);
    }
    const relativeName = displayPath(rootDir, canonical);
    const emittedRelative = relativeName.replace(/\.(?:tsx?|mts|cts|jsx?|mjs|cjs)$/i, outputExtension(canonical));
    const output = resolve(outDir, "__vibelang_foreign__", emittedRelative);
    const outputKey = collisionKey(output);
    const priorOwner = outputOwners.get(outputKey);
    if (priorOwner && priorOwner !== canonical) {
      throw new TypeError(`runtime outputs collide: ${priorOwner} and ${canonical} -> ${output}`);
    }
    outputOwners.set(outputKey, canonical);
    const aliases = targetAliases.get(canonical) ?? new Set<string>();
    aliases.add(alias);
    targetAliases.set(canonical, aliases);
    const priorAlias = resolvedOutputByAlias.get(alias);
    if (priorAlias && priorAlias !== output) {
      throw new TypeError(`relative runtime specifier is ambiguous at ${alias}`);
    }
    resolvedOutputByAlias.set(alias, output);
    resolvedOutputByAlias.set(canonical, output);
    pendingChecker.delete(canonical);
    if (!foreignByName.has(canonical)) pendingRuntime.add(canonical);
    return output;
  };

  const reserveCheckerDependency = (canonical: string): void => {
    if (!isInside(rootDir, canonical) || canonical === rootDir) {
      throw new TypeError(`relative checker dependency is outside the project root: ${canonical}`);
    }
    const extension = extensionOf(canonical);
    if (!DECLARATION_PATTERN.test(canonical) && !FOREIGN_EXTENSIONS.has(extension)) {
      throw new TypeError(`unsupported relative checker dependency '${canonical}' (${extension || "no extension"})`);
    }
    if (!foreignByName.has(canonical) && !pendingRuntime.has(canonical) && !checkerOnlyFiles.has(canonical)) {
      pendingChecker.add(canonical);
    }
  };

  const resolveEdge = (
    containingFile: string,
    containingOutput: string,
    edge: ModuleEdge,
    fromVibeLang: boolean,
    checkerOnly = false,
  ): ResolvedEdge => {
    const importerFormat = fromVibeLang ? "esm" : formatOf(containingFile);
    if (!checkerOnly && !edge.typeOnly && importerFormat === "esm" &&
      (edge.kind === "require" || edge.kind === "import-equals")) {
      throw new TypeError(
        `${containingFile}: ESM sources cannot use ${edge.kind === "require" ? "require()" : "import=require"}; ` +
        "use import syntax or a .cjs/.cts module",
      );
    }
    if (!checkerOnly && !edge.typeOnly && importerFormat === "cjs" && edge.kind === "dynamic-import") {
      throw new TypeError(`${containingFile}: dynamic import from bounded CJS output is not yet supported`);
    }
    // An asset specifier is not a module edge, so it is answered before every
    // rule below that describes one — the same position the reference path's
    // `generatedByAlias` hit occupies, and for the same reason: an asset has
    // already been resolved by an asset pass, and neither the VibeLang dynamic
    // import deferral nor the foreign-code resolver has anything to say about
    // it. This is reached only under `assetSpecifiers: "stage"`.
    if (fromVibeLang && edge.specifier.startsWith(".")) {
      const literal = resolve(dirname(containingFile), edge.specifier);
      if (namesAnAsset(edge, literal)) {
        reserveAsset(literal);
        return edge;
      }
    }
    // A compiler-generated asset module is content the compiler itself wrote at
    // a path it owns, so its exact rewrite map is already known. That is the one
    // literal dynamic import a VibeLang module may spell; every other VibeLang dynamic
    // edge still waits on the frontend.
    const generated = fromVibeLang && edge.specifier.startsWith(".")
      ? generatedByAlias.get(resolve(dirname(containingFile), edge.specifier))
      : undefined;
    if (fromVibeLang && !edge.typeOnly && edge.kind === "dynamic-import" && generated === undefined) {
      throw new TypeError(
        `${containingFile}: VibeLang dynamic import is deferred until the frontend can preserve its exact rewrite map`,
      );
    }
    if (!edge.specifier.startsWith(".")) return edge;
    if (fromVibeLang) {
      if (generated !== undefined) {
        if (edge.typeOnly ||
          (edge.kind !== "import" && edge.kind !== "export" && edge.kind !== "dynamic-import")) {
          throw new TypeError(
            `${containingFile}: compiler-generated assets require a static import, a re-export, ` +
            "or a literal dynamic import that binds the module at runtime",
          );
        }
        return {
          ...edge,
          targetFileName: generated.fileName,
          targetOutputFileName: generated.outputFileName,
        };
      }
      const vibelangTarget = resolveVibeLangSpecifier(containingFile, edge.specifier);
      if (vibelangTarget) {
        if (!vibelangByName.has(vibelangTarget)) {
          throw new TypeError(`relative VibeLang dependency was not loaded into the project: ${vibelangTarget}`);
        }
        if (!edge.typeOnly && (edge.kind === "require" || edge.kind === "import-equals")) {
          throw new TypeError(`VibeLang modules may only load another .vibe module through a static import/export: ${containingFile}`);
        }
        return { ...edge, targetFileName: vibelangTarget };
      }
      // Preserve the language frontend's source-located missing-module
      // diagnostic for an explicitly authored VibeLang edge.
      if (edge.specifier.endsWith(".vibe")) return edge;
    }
    const foreign = resolveForeignSpecifier(containingFile, edge.specifier, checkerOnly || edge.typeOnly);
    if (!foreign) {
      const graph = edge.typeOnly || checkerOnly ? "checker dependency" : "runtime import";
      throw new TypeError(`${containingFile}: unresolved relative ${graph} ${JSON.stringify(edge.specifier)}`);
    }
    if (vibelangByName.has(foreign.canonical)) {
      throw new TypeError(`foreign modules may not import a .vibe implementation: ${containingFile}`);
    }
    if (edge.typeOnly || checkerOnly) {
      reserveCheckerDependency(foreign.canonical);
      return { ...edge, targetFileName: foreign.canonical };
    }
    const targetOutput = reserveForeign(foreign.canonical, foreign.alias);
    const targetFormat = formatOf(foreign.canonical);
    if (importerFormat === "cjs" && edge.kind !== "dynamic-import" && targetFormat === "esm") {
      throw new TypeError(`${containingFile}: bounded CJS output cannot synchronously load ESM module ${foreign.canonical}`);
    }
    return {
      ...edge,
      targetFileName: foreign.canonical,
      targetOutputFileName: targetOutput,
    };
  };

  for (const source of options.vibelangSources) {
    const absolute = resolve(source.fileName);
    const output = options.vibelangOutputs.find((candidate) => resolve(candidate.sourceFileName) === absolute)?.outputFileName;
    if (!output) throw new TypeError(`VibeLang runtime output is missing for ${absolute}`);
    for (const edge of scanEdges(source.source, absolute, options.assetSpecifiers === "stage")) {
      const resolvedEdge = resolveEdge(absolute, resolve(output), edge, true);
      if (resolvedEdge.moduleInitialization && resolvedEdge.targetFileName &&
        !vibelangByName.has(resolvedEdge.targetFileName) && !generatedByName.has(resolvedEdge.targetFileName)) {
        staticInitializationRoots.add(resolvedEdge.targetFileName);
      }
    }
  }

  const loadSnapshot = (fileName: string): ReturnType<typeof readBoundedUtf8> => {
    const existing = snapshots.get(fileName);
    if (existing) return existing;
    if (fileCount >= options.budget.maximumFiles) {
      throw new TypeError(`relative runtime project exceeds ${options.budget.maximumFiles} source files`);
    }
    const snapshot = readBoundedUtf8(fileName, options.budget.maximumFileBytes);
    const identity = `${snapshot.dev}:${snapshot.ino}`;
    const priorIdentity = identityOwners.get(identity);
    if (priorIdentity && priorIdentity !== fileName) {
      throw new TypeError(`project sources are hard-link aliases of one file: ${priorIdentity} and ${fileName}`);
    }
    identityOwners.set(identity, fileName);
    fileCount += 1;
    totalBytes += snapshot.bytes;
    if (totalBytes > options.budget.maximumTotalBytes) {
      throw new TypeError(`relative runtime project exceeds ${options.budget.maximumTotalBytes} source bytes`);
    }
    snapshots.set(fileName, snapshot);
    return snapshot;
  };

  while (pendingRuntime.size > 0 || pendingChecker.size > 0) {
    const runtime = pendingRuntime.size > 0;
    const selected = runtime ? pendingRuntime : pendingChecker;
    const fileName = [...selected].sort(compareText)[0]!;
    selected.delete(fileName);
    if (runtime ? foreignByName.has(fileName) : foreignByName.has(fileName) || checkerOnlyFiles.has(fileName)) continue;
    const snapshot = loadSnapshot(fileName);
    factsFor(snapshot.source, fileName);
    if (!runtime) {
      checkerEdges.set(fileName, scanEdges(snapshot.source, fileName).map(edge => resolveEdge(fileName, fileName, edge, false, true)));
      checkerOnlyFiles.add(fileName);
      continue;
    }
    const relativeName = displayPath(rootDir, fileName);
    const output = resolvedOutputByAlias.get(fileName);
    if (!output) throw new TypeError(`relative runtime output is missing for ${fileName}`);
    if ([".js", ".mjs", ".cjs"].includes(extensionOf(fileName))) {
      const companion = resolveForeignSpecifier(fileName, `./${basename(fileName)}`, true);
      if (companion && DECLARATION_PATTERN.test(companion.canonical)) {
        reserveCheckerDependency(companion.canonical);
        pairedDeclarations.set(companion.canonical, output);
      }
    }
    const edges = scanEdges(snapshot.source, fileName).map((edge) => resolveEdge(fileName, output, edge, false));
    foreignByName.set(fileName, {
      fileName,
      displayName: relativeName,
      source: snapshot.source,
      outputFileName: output,
      format: formatOf(fileName),
      edges,
      aliases: targetAliases.get(fileName) ?? new Set(),
    });
  }

  const foreignFiles = [...foreignByName.values()].sort((left, right) => compareText(left.fileName, right.fileName))
    .map((file): RelativeRuntimeFile => ({
      fileName: file.fileName,
      displayName: file.displayName,
      source: file.source,
      rewrittenSource: rewriteLiterals(file.source, file.edges.flatMap((edge) =>
        edge.targetOutputFileName
          ? [{ start: edge.start, end: edge.end, text: relativeSpecifier(file.outputFileName, edge.targetOutputFileName) }]
          : [])),
      outputFileName: file.outputFileName,
      format: file.format,
      resolutionAliases: [...file.aliases].sort(compareText),
    }));
  const files = [...generatedByName.values(), ...foreignFiles]
    .sort((left, right) => compareText(left.fileName, right.fileName));
  // Every path this compilation will write. A dynamic specifier the frontend
  // already restated against one of them is finished, so the rewrite below
  // stays idempotent no matter which stage performed it.
  const emittedOutputs = new Set([
    ...files.map((file) => collisionKey(file.outputFileName)),
    ...options.vibelangOutputs.map((reservation) => collisionKey(resolve(reservation.outputFileName))),
  ]);

  // Only the graph module evaluation actually reaches needs an initialization
  // trust claim, and `moduleInitialization` is what decides that, one edge at a
  // time, in `scanEdges`. Its default is "initialization" and "deferred" is the
  // case that must be proven by the native compiler's shared initialization
  // classifier. The flag is read here and at the `.vibe` seed loop above;
  // on a `.vibe` edge it is inert, because a VibeLang dynamic import either
  // resolves to a compiler-generated asset (never a trust root) or is refused
  // outright a few lines into `resolveEdge`. It is foreign modules — reached at
  // depth one and beyond, where no other implementation of this rule looks —
  // whose edges this classification actually governs.
  const initializationRequired = new Set<string>();
  const initializationPending = [...staticInitializationRoots].sort(compareText);
  while (initializationPending.length > 0) {
    const fileName = initializationPending.shift()!;
    if (initializationRequired.has(fileName)) continue;
    initializationRequired.add(fileName);
    const file = foreignByName.get(fileName);
    if (!file) continue;
    for (const edge of file.edges) {
      if (!edge.moduleInitialization || !edge.targetFileName ||
        !foreignByName.has(edge.targetFileName) || initializationRequired.has(edge.targetFileName)) continue;
      initializationPending.push(edge.targetFileName);
    }
    initializationPending.sort(compareText);
  }
  const diagnostics: RuntimeGraphDiagnostic[] = [...initializationRequired]
    .sort(compareText)
    .flatMap((fileName) => {
      const file = foreignByName.get(fileName);
      if (!file || hasLeadingModuleNoThrowMarker(file.source, file.fileName)) return [];
      const position = factsFor(file.source, file.fileName).firstStatement;
      return [{
        code: "VIBE1510" as const,
        severity: "error" as const,
        message: "foreign module initialization can panic before a checked call boundary; add a leading JSDoc containing both @module and @throws {never}, or load it with dynamic import inside a checked async foreign adapter",
        fileName: file.fileName,
        line: position.line,
        column: position.column,
      }];
    });

  const declarationOutputs = new Map<string, string>();
  const visitDeclaration = (fileName: string): void => {
    if (declarationOutputs.has(fileName) || foreignByName.has(fileName)) return;
    if (!checkerOnlyFiles.has(fileName)) throw new TypeError(`uncaptured declaration dependency: ${fileName}`);
    const paired = pairedDeclarations.get(fileName);
    const extension = extensionOf(fileName);
    const output = paired ? paired.replace(/\.(mjs|cjs)$/, (_, kind) => kind === "cjs" ? ".d.cts" : ".d.mts")
      : resolve(outDir, "__vibelang_foreign__", displayPath(rootDir, fileName).slice(0, -extension.length) +
        (DECLARATION_PATTERN.test(fileName) ? (formatOf(fileName) === "cjs" ? ".d.cts" : ".d.mts") : outputExtension(fileName)));
    const key = collisionKey(output);
    const owner = outputOwners.get(key);
    if (owner && owner !== fileName) throw new TypeError(`declaration outputs collide: ${owner} and ${fileName} -> ${output}`);
    outputOwners.set(key, fileName);
    declarationOutputs.set(fileName, output);
    for (const edge of checkerEdges.get(fileName) ?? []) if (edge.targetFileName) visitDeclaration(edge.targetFileName);
  };
  for (const fileName of pairedDeclarations.keys()) visitDeclaration(fileName);
  const declarationSources = [...declarationOutputs].sort(([a], [b]) => compareText(a, b)).map(([fileName, outputFileName]) => ({
    fileName, outputFileName,
    ...(pairedDeclarations.has(fileName) ? { runtimeOutputFileName: pairedDeclarations.get(fileName)! } : {}),
    code: rewriteLiterals(snapshots.get(fileName)!.source, (checkerEdges.get(fileName) ?? []).flatMap(edge => {
      if (!edge.targetFileName) return [];
      const output = declarationOutputs.get(edge.targetFileName) ?? resolvedOutputByAlias.get(edge.targetFileName);
      if (!output) return [];
      const module = output.replace(/\.d\.mts$/, ".mjs").replace(/\.d\.cts$/, ".cjs");
      return [{ start: edge.start, end: edge.end, text: relativeSpecifier(outputFileName, module) }];
    })),
  }));

  return {
    files,
    diagnostics,
    declarationSources,
    checkerDependencies: [...checkerOnlyFiles].sort(compareText).map((fileName) => ({
      fileName,
      displayName: displayPath(rootDir, fileName),
      source: snapshots.get(fileName)!.source,
    })),
    stagedAssets: [...stagedAssetByName.keys()].sort(compareText).map((fileName) => stagedAssetByName.get(fileName)!),
    fileCount,
    totalBytes,
    additionalRuntimeOutputs: files.map((file) => ({
      sourceFileName: file.fileName,
      outputFileName: file.outputFileName,
      resolutionAliases: file.resolutionAliases,
      ...(generatedByName.has(file.fileName) ? { stripImportAttributes: true as const } : {}),
    })),
    rewriteVibeLangRuntimeCalls(code, authoredFileName, outputFileName) {
      const calls = scanEmittedEdges(code, outputFileName).filter((edge) => edge.kind === "dynamic-import");
      const replacements = calls.flatMap((edge) => {
        if (!edge.specifier.startsWith(".")) return [];
        const alias = resolve(dirname(authoredFileName), edge.specifier);
        // A literal dynamic asset import survives the frontend's static pass, so
        // the generated identity is resolved here beside the foreign graph.
        const targetOutput = generatedByAlias.get(alias)?.outputFileName ?? resolvedOutputByAlias.get(alias);
        if (!targetOutput) {
          if (emittedOutputs.has(collisionKey(resolve(dirname(outputFileName), edge.specifier)))) return [];
          throw new TypeError(`${authoredFileName}: unresolved emitted dynamic import ${JSON.stringify(edge.specifier)}`);
        }
        return [{ start: edge.start, end: edge.end, text: relativeSpecifier(outputFileName, targetOutput) }];
      });
      return rewriteLiterals(code, replacements);
    },
  };
}

function declarationInput(file: RelativeRuntimeFile, javascript: string): string {
  // The declaration emitter parses virtual `.mjs` inputs as TS. JSX must first
  // be erased; non-JSX TypeScript retains its authored type information.
  const extension = extensionOf(file.fileName);
  if (extension === ".tsx" || extension === ".jsx") return `// @ts-nocheck\n${javascript}`;
  if (extension === ".cjs") return `${file.rewrittenSource}\nexport default module.exports\n`;
  return file.rewrittenSource;
}

function validationInput(file: RelativeRuntimeFile, javascript: string): string {
  const extension = extensionOf(file.fileName);
  if (extension === ".cjs") return `// @ts-nocheck\n${javascript}\nexport default module.exports\n`;
  if (extension === ".tsx" || extension === ".jsx") return `// @ts-nocheck\n${javascript}`;
  return file.rewrittenSource;
}

/** Transpile the already-resolved graph; this performs no writes. */
export function transpileRelativeRuntimeGraph(
  graph: RelativeRuntimeGraph,
  options: { readonly sourceMap?: boolean },
): TranspiledRuntimeGraph {
  const diagnostics: NativeDiagnostic[] = [];
  const files = graph.files.map((file): TranspiledRuntimeFile => {
    // Resolution and trust checks already captured this source. Native erasure
    // performs no resolution and is not a substitute for subsequent checking.
    const emitted = getNativeCompiler().transpile({
      files: [{ path: file.displayName, text: file.rewrittenSource }],
      options: {
        target: "es2022",
        module: file.format === "cjs" ? "commonjs" : "esnext",
        jsx: "react",
        sourceMap: options.sourceMap === true,
        inlineSources: options.sourceMap === true,
      },
    }).files[0]!;
    diagnostics.push(...emitted.diagnostics.filter(diagnostic => diagnostic.category === "error")
      .map(diagnostic => ({ ...diagnostic, ...(diagnostic.file === undefined ? {} : { file: file.fileName }) })));
    let code = emitted.emitSkipped ? "" : emitted.javascript.replace(/\n?\/\/# sourceMappingURL=.*(?:\r?\n)?$/, "").trimEnd() + "\n";
    let sourceMap: string | undefined;
    if (options.sourceMap && !emitted.emitSkipped) {
      if (!emitted.sourceMap) {
        diagnostics.push({
          category: "error",
          code: "TS95001",
          phase: "emit",
          message: `TypeScript emitted no source map for ${file.fileName}`,
        });
      } else {
        const parsed = JSON.parse(emitted.sourceMap) as Record<string, unknown> & {
          version: number;
          sources: string[];
        };
        if (parsed.version !== 3 || !Array.isArray(parsed.sources) || parsed.sources.length !== 1) {
          throw new TypeError(`foreign source map has an unsupported shape: ${file.fileName}`);
        }
        let source = relative(dirname(file.outputFileName), file.fileName).split(sep).join("/");
        if (!source.startsWith(".")) source = `./${source}`;
        parsed.file = basename(file.outputFileName);
        parsed.sources = [source];
        parsed.sourcesContent = [file.source];
        sourceMap = JSON.stringify(parsed);
        code += `//# sourceMappingURL=${basename(file.outputFileName)}.map\n`;
      }
    }
    return {
      ...file,
      code,
      sourceMap,
      validationCode: validationInput(file, code),
      declarationCode: declarationInput(file, code),
    };
  });
  return { files, diagnostics };
}
