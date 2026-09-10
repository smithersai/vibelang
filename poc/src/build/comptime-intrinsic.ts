import { extname } from "node:path";
import { getNativeCompiler } from "../compiler/native.ts";
import type {
  NativeComptimePlanRange,
  NativeComptimePlanRequest,
  NativeComptimePlanResult,
  NativeInspectionSource,
} from "../compiler/protocol.ts";
import type { AssetDependency } from "./assets.ts";
import { type ComptimeBuild, ComptimeCompiler } from "./comptime.ts";
import { decodeComptimeValue } from "./comptime-value.ts";
import { DEFAULT_SCHEMA_RUNTIME_IMPORT } from "./schema-derive.ts";
import { canonical, compareStableStrings, digest, type StableJson } from "./stable.ts";

export const COMPTIME_MODULE_SPECIFIER = "vibelang:comptime";
export const COMPTIME_RUNTIME_ERROR =
  '"vibelang:comptime" is compiler-only; compile this module before ordinary JavaScript execution';

/** Loading the uncompiled virtual module rejects before any importer runs. */
export const COMPTIME_RUNTIME_GUARD_SOURCE =
  `export function comptime(_value) { throw new Error(${JSON.stringify(COMPTIME_RUNTIME_ERROR)}); }\n` +
  `throw new Error(${JSON.stringify(COMPTIME_RUNTIME_ERROR)});\n`;

export const ComptimeIntrinsicDiagnosticCode = Object.freeze({
  Syntax: "VCT1000",
  MissingIdentity: "VCT1001",
  /** Retired: an unrelated binding named comptime must remain ordinary code. */
  UnrelatedIdentity: "VCT1002",
  Arity: "VCT1003",
  UnsupportedExpression: "VCT1004",
  NoncanonicalResult: "VCT1005",
  UnsupportedUse: "VCT1006",
  BuildFailure: "VCT1007",
  InternalIdentity: "VCT1008",
  SourceMapFailure: "VCT1009",
  InvalidFunction: "VCT1010",
  TrackedInput: "VCT1011",
  Budget: "VCT1012",
  TypeProduction: "VCT1013",
  SchemaOutsideComptime: "VCT1200",
  SchemaCallShape: "VCT1201",
  SchemaUnrelatedIdentity: "VCT1202",
  SchemaImportShape: "VCT1203",
  SchemaUnsupportedType: "VCT1204",
  SchemaReservedIdentifier: "VCT1205",
  SchemaInternalIdentity: "VCT1206",
  SchemaBudget: "VCT1207",
} as const);

export interface ComptimeIntrinsicDiagnostic {
  readonly code: typeof ComptimeIntrinsicDiagnosticCode[keyof typeof ComptimeIntrinsicDiagnosticCode];
  readonly severity: "error";
  readonly message: string;
  readonly file: string;
  /** One-based line. */
  readonly line: number;
  /** One-based column. */
  readonly column: number;
  readonly length: number;
}

export interface ComptimeIntrinsicCall {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
  readonly value: StableJson;
  readonly build: ComptimeBuild;
}

/** Authored UTF-16 range. Offsets are zero-based; lines and columns are one-based. */
export interface ComptimeSourceRange {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/** Lowered UTF-16 range. Offsets are zero-based; lines and columns are one-based. */
export interface ComptimeGeneratedRange {
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
}

export interface ComptimeLoweringEdit {
  readonly kind: "remove-import" | "function-marker" | "intrinsic-call" | "schema-runtime-import" | "type-alias";
  readonly generated: ComptimeGeneratedRange;
  readonly authored: ComptimeSourceRange;
  readonly mappedOrigin: ComptimeSourceRange;
  /** The call argument and project-local initializer/return expressions read. */
  readonly origins: readonly ComptimeSourceRange[];
  readonly replacementDigest: string;
}

export interface ComptimeLoweringProvenance {
  readonly schema: "vibelang.comptime-lowering/v1";
  readonly frontend: "vibelang-comptime-native@1";
  readonly file: string;
  readonly authoredDigest: string;
  readonly loweredDigest: string;
  readonly edits: readonly ComptimeLoweringEdit[];
}

export interface ComptimeLoweredFile {
  readonly fileName: string;
  readonly code: string;
  /** Canonical JSON encoding of a version-3 source map. */
  readonly sourceMap: string;
  readonly provenance: ComptimeLoweringProvenance;
  /** Includes the native implementation and complete supplied source closure. */
  readonly identity: string;
}

export interface ComptimeIntrinsicResult {
  readonly ok: boolean;
  readonly calls: readonly ComptimeIntrinsicCall[];
  readonly diagnostics: readonly ComptimeIntrinsicDiagnostic[];
  /** Present only when every compiler-owned use was safely lowered. */
  readonly loweredSources?: Readonly<Record<string, string>>;
  readonly loweredFiles?: Readonly<Record<string, ComptimeLoweredFile>>;
}

export interface CompileComptimeIntrinsicsOptions {
  readonly compiler: ComptimeCompiler;
  /** Project-relative TypeScript, JavaScript, or `.vibe` source names. */
  readonly sources: Readonly<Record<string, string>>;
  /** Only files that actually derive a schema gain this generated import edge. */
  readonly schemaRuntimeImport?: string;
}

/** The virtual declaration also underlies the loader registration surface. */
export const COMPTIME_PRELUDE = [
  "export declare function comptime<T>(value: T): T;",
  "export declare namespace comptime { const target: string; }",
  "export declare function embed(specifier: string): string;",
  "",
].join("\n");

const FRONTEND = "vibelang-comptime-native@1";
const MAX_SOURCE_MAP_UNITS = 1_000_000;
const MAX_SOURCE_MAP_BYTES = 16 * 1024 * 1024;
const MAX_TRACKED_INPUT_ROUNDS = 128;
const MAX_TRACKED_INPUTS = 10_000;
const MAX_TRACKED_INPUT_BYTES = 16 * 1024 * 1024;
const SOURCE_MAP_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

interface ProjectEntry {
  readonly publicName: string;
  readonly source: string;
  readonly lineStarts: readonly number[];
}
type Replacement = NativeComptimePlanResult["edits"][number];
type PlannedCall = NativeComptimePlanResult["calls"][number];
type TrackedInput = NativeComptimePlanRequest["inputs"][number];

/**
 * Thin phase host. The pinned Go compiler owns parsing, binding, interpretation,
 * type reification and replacement text. This adapter supplies only explicitly
 * requested, root-confined text snapshots, caches proven values and composes
 * authored-span source maps. It never executes author code or falls back to a
 * JavaScript compiler/evaluator.
 */
export async function compileComptimeIntrinsics(
  options: CompileComptimeIntrinsicsOptions,
): Promise<ComptimeIntrinsicResult> {
  const entries: ProjectEntry[] = Object.entries(options.sources)
    .sort(([left], [right]) => compareStableStrings(left, right))
    .map(([publicName, source]) => {
      if (typeof source !== "string") throw new TypeError(`source ${JSON.stringify(publicName)} must be text`);
      return { publicName, source, lineStarts: computeLineStarts(source) };
    });
  if (entries.length === 0) throw new TypeError("comptime frontend requires at least one source file");
  const entryByFile = new Map(entries.map(entry => [entry.publicName, entry]));
  const files: NativeInspectionSource[] = entries.map(entry => {
    const extension = extname(entry.publicName).toLowerCase();
    return { path: entry.publicName, text: entry.source,
      scriptKind: extension === ".tsx" ? "tsx" : extension === ".jsx" ? "jsx" :
        [".js", ".mjs", ".cjs"].includes(extension) ? "javascript" : "typescript" };
  });
  const compiler = getNativeCompiler();
  const request = { files, target: options.compiler.target,
    schemaRuntimeImport: options.schemaRuntimeImport ?? DEFAULT_SCHEMA_RUNTIME_IMPORT };
  // A dependency-only source edit or native implementation change invalidates
  // the cache even when it happens to derive byte-identical output this time.
  const frontendIdentity = digest({ frontend: FRONTEND, compiler: compiler.identity,
    transport: compiler.transportDigest, request });
  const inputs: TrackedInput[] = [];
  const inputKeys = new Set<string>();
  const dependencies: (AssetDependency | undefined)[] = [];
  let inputBytes = 0;
  let plan: NativeComptimePlanResult;
  for (let round = 0;; round++) {
    plan = compiler.planComptime({ ...request, inputs });
    if (plan.diagnostics.length > 0) {
      return failedResult(plan.diagnostics.map(issue => makeDiagnostic(
        entryByFile.get(issue.at.file)!, issue.at.span.start, issue.at.span.length,
        issue.code as ComptimeIntrinsicDiagnostic["code"], issue.message,
      )));
    }
    if (plan.complete) break;
    const first = plan.reads[0]!; // The protocol rejects an empty incomplete plan.
    const refuseBudget = (at: NativeComptimePlanRange, message: string) => failedResult([
      makeDiagnostic(entryByFile.get(at.file)!, at.span.start, at.span.length,
        ComptimeIntrinsicDiagnosticCode.Budget, message),
    ]);
    if (round >= MAX_TRACKED_INPUT_ROUNDS) {
      return refuseBudget(first.at, `comptime input discovery exceeds ${MAX_TRACKED_INPUT_ROUNDS} rounds`);
    }
    let progress = false;
    for (const read of plan.reads) {
      const key = `${read.at.file}\0${read.specifier}`;
      if (inputKeys.has(key)) continue;
      if (inputs.length >= MAX_TRACKED_INPUTS) {
        return refuseBudget(read.at, `comptime input discovery exceeds ${MAX_TRACKED_INPUTS} snapshots`);
      }
      let text = "", error = "";
      let dependency: AssetDependency | undefined;
      try {
        const tracked = options.compiler.readTrackedText(read.specifier, { from: read.at.file });
        text = tracked.value;
        dependency = tracked.dependency;
      } catch (cause) {
        // Supply a bounded failure as data; the native evaluator attaches the
        // language diagnostic to the actual reached embed, including imports.
        error = (cause instanceof Error ? cause.message : String(cause)).slice(0, 4_000) || "tracked input failed";
      }
      inputBytes += Buffer.byteLength(text, "utf8");
      if (inputBytes > MAX_TRACKED_INPUT_BYTES) {
        return refuseBudget(read.at, `comptime tracked text exceeds ${MAX_TRACKED_INPUT_BYTES} bytes`);
      }
      inputs.push({ file: read.at.file, specifier: read.specifier, text, error });
      dependencies.push(dependency);
      inputKeys.add(key);
      progress = true;
    }
    if (!progress) throw new TypeError("native comptime phase requested an already supplied input");
  }

  // Prepare and validate all maps before any content-addressed cache write.
  let loweredFiles: Readonly<Record<string, ComptimeLoweredFile>>;
  try {
    const lowered: Record<string, ComptimeLoweredFile> = Object.create(null);
    for (const entry of entries) {
      lowered[entry.publicName] = lowerFile(entry,
        plan.edits.filter(edit => edit.at.file === entry.publicName), entryByFile, frontendIdentity);
    }
    loweredFiles = Object.freeze(lowered);
  } catch (cause) {
    const failure = cause instanceof SourceMapGenerationError ? cause : undefined;
    return failedResult([makeDiagnostic(failure?.entry ?? entries[0]!, failure?.start ?? 0, 1,
      ComptimeIntrinsicDiagnosticCode.SourceMapFailure,
      failure?.message ?? "comptime lowering could not produce a correct source map")]);
  }

  const settled = await Promise.allSettled(plan.calls.map(async item => ({ item,
    build: await options.compiler.evaluateStatic(decodeComptimeValue(JSON.parse(item.valueJson)), {
      identity: { frontendIdentity, at: item.at, argument: item.argument, schemaType: item.schemaType },
      dependencies: callDependencies(item, dependencies),
    }),
  })));
  const calls: ComptimeIntrinsicCall[] = [];
  const diagnostics: ComptimeIntrinsicDiagnostic[] = [];
  for (const [index, result] of settled.entries()) {
    const item = plan.calls[index]!;
    const entry = entryByFile.get(item.at.file)!;
    if (result.status === "rejected") {
      diagnostics.push(makeDiagnostic(entry, item.at.span.start, item.at.span.length,
        ComptimeIntrinsicDiagnosticCode.BuildFailure, "static comptime cache operation failed"));
      continue;
    }
    const { build } = result.value;
    const location = locateOffset(entry.lineStarts, item.at.span.start);
    calls.push(Object.freeze({ file: entry.publicName, start: item.at.span.start,
      end: item.at.span.start + item.at.span.length, line: location.line + 1, column: location.column + 1,
      value: build.value, build }));
  }
  if (diagnostics.length > 0) return failedResult(diagnostics);
  const loweredSources: Record<string, string> = Object.create(null);
  for (const entry of entries) loweredSources[entry.publicName] = loweredFiles[entry.publicName]!.code;
  return Object.freeze({ ok: true, calls: Object.freeze(calls), diagnostics: Object.freeze([]),
    loweredSources: Object.freeze(loweredSources), loweredFiles });
}

function callDependencies(item: PlannedCall, inputs: readonly (AssetDependency | undefined)[]): readonly AssetDependency[] {
  const unique = new Map<string, AssetDependency>();
  for (const index of item.inputs) {
    const dependency = inputs[index];
    if (!dependency) throw new TypeError("native comptime value used an unsuccessful tracked input");
    const key = `${dependency.path}\0${dependency.access}`;
    const previous = unique.get(key);
    if (previous && previous.digest !== dependency.digest) throw new TypeError("tracked input changed during comptime evaluation");
    unique.set(key, dependency);
  }
  return [...unique.values()].sort((left, right) => compareStableStrings(left.path, right.path) ||
    compareStableStrings(left.access ?? "", right.access ?? ""));
}

class SourceMapGenerationError extends Error {
  constructor(readonly entry: ProjectEntry, readonly start: number, message: string) {
    super(message);
    this.name = "SourceMapGenerationError";
  }
}

interface EmittedSpan {
  readonly generatedStart: number;
  readonly text: string;
  readonly origin: ProjectEntry;
  readonly originalStart: number;
  readonly exact: boolean;
}
interface SourceMapping {
  readonly generatedLine: number;
  readonly generatedColumn: number;
  readonly source: number;
  readonly originalLine: number;
  readonly originalColumn: number;
}

/** Compose only native-authored ranges; this code performs no syntax analysis. */
function lowerFile(entry: ProjectEntry, replacements: readonly Replacement[],
  entryByFile: ReadonlyMap<string, ProjectEntry>, frontendIdentity: string): ComptimeLoweredFile {
  const parts: string[] = [];
  const spans: EmittedSpan[] = [];
  const pendingEdits: { replacement: Replacement; generatedStart: number; generatedEnd: number }[] = [];
  const sourceEntries = new Set<ProjectEntry>([entry]);
  let authoredCursor = 0, generatedCursor = 0;
  const appendExact = (start: number, end: number): void => {
    const text = entry.source.slice(start, end);
    if (text.length === 0) return;
    parts.push(text);
    spans.push({ generatedStart: generatedCursor, text, origin: entry, originalStart: start, exact: true });
    generatedCursor += text.length;
  };
  for (const replacement of replacements) {
    const start = replacement.at.span.start, end = start + replacement.at.span.length;
    if (replacement.at.file !== entry.publicName || start < authoredCursor || end < start || end > entry.source.length) {
      throw new SourceMapGenerationError(entry, Math.max(0, start), "overlapping or invalid comptime source replacement");
    }
    const mappedEntry = entryByFile.get(replacement.mappedOrigin.file);
    if (!mappedEntry) throw new SourceMapGenerationError(entry, start, "comptime replacement origin is outside the checked project");
    sourceEntries.add(mappedEntry);
    for (const origin of replacement.origins) {
      const originEntry = entryByFile.get(origin.file);
      if (!originEntry) throw new SourceMapGenerationError(entry, start, "comptime provenance origin is outside the checked project");
      sourceEntries.add(originEntry);
    }
    appendExact(authoredCursor, start);
    const generatedStart = generatedCursor;
    if (replacement.text.length > 0) {
      parts.push(replacement.text);
      spans.push({ generatedStart, text: replacement.text, origin: mappedEntry,
        originalStart: replacement.mappedOrigin.span.start, exact: false });
      generatedCursor += replacement.text.length;
    }
    pendingEdits.push({ replacement, generatedStart, generatedEnd: generatedCursor });
    authoredCursor = end;
  }
  appendExact(authoredCursor, entry.source.length);
  const code = parts.join("");
  if (code.length > MAX_SOURCE_MAP_UNITS) {
    throw new SourceMapGenerationError(entry, 0, `comptime source map exceeds the ${MAX_SOURCE_MAP_UNITS} UTF-16 unit POC limit`);
  }
  const orderedSources = [entry, ...[...sourceEntries].filter(source => source !== entry)
    .sort((left, right) => compareStableStrings(left.publicName, right.publicName))];
  const sourceIndex = new Map(orderedSources.map((source, index) => [source, index]));
  const generatedLineStarts = computeLineStarts(code);
  const mappingsByCoordinate = new Map<string, SourceMapping>();
  const addMapping = (generatedOffset: number, origin: ProjectEntry, originalOffset: number): void => {
    if (generatedOffset < 0 || generatedOffset > code.length || originalOffset < 0 || originalOffset > origin.source.length) {
      throw new SourceMapGenerationError(entry, 0, "comptime source map contains an out-of-range coordinate");
    }
    const generated = locateOffset(generatedLineStarts, generatedOffset);
    const original = locateOffset(origin.lineStarts, originalOffset);
    mappingsByCoordinate.set(`${generated.line}:${generated.column}`, {
      generatedLine: generated.line, generatedColumn: generated.column, source: sourceIndex.get(origin)!,
      originalLine: original.line, originalColumn: original.column,
    });
  };
  for (const span of spans) {
    for (let offset = 0; offset < span.text.length; offset++) {
      if (isLineBreakUnit(span.text, offset)) continue;
      addMapping(span.generatedStart + offset, span.origin, span.exact ? span.originalStart + offset : span.originalStart);
    }
  }
  for (const edit of pendingEdits) {
    // Erased imports still have a boundary. Following text resumes exact mapping.
    addMapping(edit.generatedEnd, entry, edit.replacement.at.span.start + edit.replacement.at.span.length);
  }
  addMapping(code.length, entry, entry.source.length);
  const edits = pendingEdits.map(({ replacement, generatedStart, generatedEnd }) => Object.freeze({
    kind: replacement.kind,
    generated: generatedRange(code, generatedLineStarts, generatedStart, generatedEnd),
    authored: sourceRange(replacement.at, entryByFile),
    mappedOrigin: sourceRange(replacement.mappedOrigin, entryByFile),
    origins: Object.freeze(replacement.origins.map(origin => sourceRange(origin, entryByFile))),
    replacementDigest: digest(replacement.text),
  } satisfies ComptimeLoweringEdit));
  const provenance = Object.freeze({ schema: "vibelang.comptime-lowering/v1", frontend: FRONTEND,
    file: entry.publicName, authoredDigest: digest(entry.source), loweredDigest: digest(code),
    edits: Object.freeze(edits) } satisfies ComptimeLoweringProvenance);
  const sourceMap = canonical({ version: 3, file: entry.publicName, sourceRoot: "",
    sources: orderedSources.map(source => source.publicName), sourcesContent: orderedSources.map(source => source.source),
    names: [], mappings: encodeSourceMappings([...mappingsByCoordinate.values()]), x_vibelang_comptime: provenance });
  if (Buffer.byteLength(sourceMap, "utf8") > MAX_SOURCE_MAP_BYTES) {
    throw new SourceMapGenerationError(entry, 0, `comptime source map exceeds the ${MAX_SOURCE_MAP_BYTES} byte POC limit`);
  }
  const identity = digest({ schema: "vibelang.comptime-lowered-file/v1", file: entry.publicName, frontendIdentity,
    authoredDigest: provenance.authoredDigest, loweredDigest: provenance.loweredDigest,
    sourceMapDigest: digest(sourceMap), provenanceDigest: digest(provenance) });
  return Object.freeze({ fileName: entry.publicName, code, sourceMap, provenance, identity });
}

function generatedRange(code: string, starts: readonly number[], start: number, end: number): ComptimeGeneratedRange {
  if (start < 0 || end < start || end > code.length) throw new TypeError("invalid generated comptime range");
  const first = locateOffset(starts, start), last = locateOffset(starts, end);
  return Object.freeze({ start, end, line: first.line + 1, column: first.column + 1,
    endLine: last.line + 1, endColumn: last.column + 1 });
}

function sourceRange(at: NativeComptimePlanRange, entryByFile: ReadonlyMap<string, ProjectEntry>): ComptimeSourceRange {
  const entry = entryByFile.get(at.file);
  if (!entry) throw new TypeError("comptime provenance range is outside the checked project");
  const start = at.span.start, end = start + at.span.length;
  if (start < 0 || end < start || end > entry.source.length) {
    throw new SourceMapGenerationError(entry, Math.max(0, start), "invalid authored comptime provenance range");
  }
  const first = locateOffset(entry.lineStarts, start), last = locateOffset(entry.lineStarts, end);
  return Object.freeze({ file: entry.publicName, start, end, line: first.line + 1, column: first.column + 1,
    endLine: last.line + 1, endColumn: last.column + 1 });
}

function computeLineStarts(text: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 13) {
      if (text.charCodeAt(index + 1) === 10) index++;
      starts.push(index + 1);
    } else if (code === 10 || code === 0x2028 || code === 0x2029) starts.push(index + 1);
  }
  return starts;
}
function locateOffset(starts: readonly number[], offset: number): { readonly line: number; readonly column: number } {
  let low = 0, high = starts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle;
  }
  return { line: low, column: offset - starts[low]! };
}
function isLineBreakUnit(text: string, offset: number): boolean {
  const code = text.charCodeAt(offset);
  return code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
}
function encodeSourceMappings(mappings: readonly SourceMapping[]): string {
  const ordered = [...mappings].sort((left, right) =>
    left.generatedLine - right.generatedLine || left.generatedColumn - right.generatedColumn);
  const maximumLine = ordered.at(-1)?.generatedLine ?? 0;
  const lines: string[] = [];
  let index = 0, previousSource = 0, previousOriginalLine = 0, previousOriginalColumn = 0;
  for (let line = 0; line <= maximumLine; line++) {
    let previousGeneratedColumn = 0;
    const segments: string[] = [];
    while (ordered[index]?.generatedLine === line) {
      const mapping = ordered[index++]!;
      segments.push(encodeSourceMapVlq(mapping.generatedColumn - previousGeneratedColumn) +
        encodeSourceMapVlq(mapping.source - previousSource) + encodeSourceMapVlq(mapping.originalLine - previousOriginalLine) +
        encodeSourceMapVlq(mapping.originalColumn - previousOriginalColumn));
      previousGeneratedColumn = mapping.generatedColumn;
      previousSource = mapping.source;
      previousOriginalLine = mapping.originalLine;
      previousOriginalColumn = mapping.originalColumn;
    }
    lines.push(segments.join(","));
  }
  return lines.join(";");
}
function encodeSourceMapVlq(value: number): string {
  if (!Number.isSafeInteger(value)) throw new TypeError("source-map coordinate is not a safe integer");
  let current = Math.abs(value) * 2 + (value < 0 ? 1 : 0);
  let encoded = "";
  do {
    let digit = current % 32;
    current = Math.floor(current / 32);
    if (current > 0) digit += 32;
    encoded += SOURCE_MAP_BASE64[digit];
  } while (current > 0);
  return encoded;
}
function makeDiagnostic(entry: ProjectEntry, start: number, length: number,
  code: ComptimeIntrinsicDiagnostic["code"], message: string): ComptimeIntrinsicDiagnostic {
  const location = locateOffset(entry.lineStarts, Math.min(Math.max(0, start), entry.source.length));
  return Object.freeze({ code, severity: "error", message, file: entry.publicName,
    line: location.line + 1, column: location.column + 1, length: Math.max(1, length) });
}
function failedResult(diagnostics: readonly ComptimeIntrinsicDiagnostic[]): ComptimeIntrinsicResult {
  return Object.freeze({ ok: false, calls: Object.freeze([]), diagnostics: Object.freeze([...diagnostics].sort((left, right) =>
    compareStableStrings(left.file, right.file) || left.line - right.line || left.column - right.column ||
    compareStableStrings(left.code, right.code) || compareStableStrings(left.message, right.message))) });
}
