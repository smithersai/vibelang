import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as ts from "typescript-js";
import { AssetCompiler } from "../build/assets.ts";
import { ComptimeCompiler } from "../build/comptime.ts";
import { compileComptimeIntrinsics } from "../build/comptime-intrinsic.ts";
import { DEFAULT_SCHEMA_RUNTIME_IMPORT } from "../build/schema-derive.ts";
import { compileSourceAssetModules, type CompiledSourceAssetModule } from "../build/source-assets.ts";
import { digest } from "../build/stable.ts";
import { analyzeProject } from "./analyze.ts";
import { formatSmithersSource, smithersTokenAt } from "./format.ts";
import type {
  Diagnostic as SmithersDiagnostic,
  ProjectAnalysis,
  ProjectFileAnalysis,
  ProjectSource,
} from "./model.ts";
import { compileProject } from "./project-compile.ts";
import { composeSourceMaps } from "./source-map.ts";
import { checkEmittedProject, DEFAULT_RUNTIME_IMPORT } from "./validate.ts";

/**
 * A bounded but genuine Smithers language server.
 *
 * The protocol is implemented directly - JSON-RPC 2.0 over stdio with
 * `Content-Length` framing - so the toolchain gains an editor surface without
 * gaining a dependency. Diagnostics, hover, and definition are all driven by
 * the real frontend, not by a reimplementation, and formatting reuses
 * `formatSmithersSource`.
 *
 * ## Verdict agreement with `smithers check`
 *
 * A diagnostic an editor shows and a diagnostic the compiler reports must be
 * the same diagnostic: a false error in an editor makes correct code look
 * broken, and a rule name that does not match the one `check` prints
 * misdescribes the program. So `computeProjectDiagnostics` runs the CLI's
 * compile stages in the CLI's order and stops where the CLI stops -
 *
 *   1. source assets  (`compileSourceAssetModules`)
 *   2. comptime       (`compileComptimeIntrinsics`)
 *   3. rows           (`analyzeProject`)
 *   4. generated TypeScript (`compileProject` + `checkEmittedProject`)
 *
 * - each earlier stage's refusal is published on its own, exactly as the CLI
 *   returns without running the later ones. Skipping stage 1 or 2 does not
 *   merely lose their diagnostics: it makes the later stages judge a program
 *   the compiler never sees, so a valid asset import drew SMITHERS1510 (an
 *   untrusted foreign module) and a valid `comptime(...)` drew TS2307. The
 *   deviations that remain are listed below.
 *
 * Both stages are content-addressed and answer from a cache under the system
 * temporary directory, in the language server's own namespace so that an editor
 * session can never write into a cache a `smithers build` is reading. Measured
 * on a one-module project: the asset stage costs under a millisecond when the
 * project imports no asset, and the comptime stage costs about as much as
 * `analyzeProject` itself, because it builds a TypeScript program of its own.
 *
 * ## Supported
 *
 * - `initialize` / `initialized` / `shutdown` / `exit`
 * - `textDocument/didOpen`, `didChange` (**full** document sync), `didClose`
 * - `textDocument/publishDiagnostics`: source-asset (`SMITHERS52xx`) and
 *   comptime (`VCT1xxx`) stage diagnostics, Smithers frontend diagnostics, plus
 *   stock TypeScript diagnostics for the generated modules mapped back to
 *   authored positions through the compiler's own source maps - composed with
 *   the comptime lowering's map when a file was actually lowered
 * - `textDocument/hover`: a checked function's channel and its inferred failure
 *   and requirement rows, and an authored Error class's fields
 * - `textDocument/definition`: project-local `.sm` functions, Error classes,
 *   and relative `.sm` module specifiers
 * - `textDocument/formatting`: `formatSmithersSource`, as a single whole-document
 *   edit; a module the formatter refuses returns no edits
 *
 * ## Deliberately not supported
 *
 * - One workspace folder. Additional folders in `initialize` are ignored, and
 *   `workspace/didChangeWorkspaceFolders` is not handled.
 * - Full-document sync only. Incremental change ranges are never requested and
 *   a client that sends one receives a diagnostic rather than a silent
 *   mis-merge.
 * - No completion, rename, references, signature help, document symbols, code
 *   actions, semantic tokens, inlay hints, or call hierarchy.
 * - No file watching. The project is re-read from disk on every edit, bounded
 *   to `MAX_PROJECT_FILES` modules and `MAX_PROJECT_BYTES` total.
 * - Project membership is the transitive relative-`.sm` import closure of the
 *   open documents, not a glob of the workspace folder.
 * - **The runtime-graph resolver does not run here, and cannot.** The CLI runs
 *   `buildRelativeRuntimeGraph` between the asset stage and the comptime stage;
 *   it lives in the ROOT package (`src/relative-runtime-graph.ts`), which
 *   imports `poc/dist`, so a module inside `poc/src` cannot reach it without
 *   inverting the dependency. Its absence is visible in three places, all
 *   measured against the corpus: a foreign relative `.ts` neighbour draws
 *   `SMITHERS1510` at the authored import rather than at the foreign module's
 *   own first line; a dynamic import is judged by the semantic stage alone; and
 *   an unresolvable relative runtime edge does not abort the run. In every one
 *   of those the CLI answers `SMITHERS_PROJECT_ERROR` or a foreign-file
 *   position and the corpus declares what this server publishes - see
 *   `conformance/product-divergence.json`, causes
 *   `runtime-graph-refuses-before-the-semantic-stage`,
 *   `duplicate-SMITHERS1510-implementation-in-the-runtime-graph` and
 *   `dynamic-import-lock-vs-corpus-vs-product`.
 * - **Rows are analyzed on the AUTHORED text, not the comptime-lowered text.**
 *   The CLI analyzes what the comptime stage produced; doing the same here
 *   would put every row diagnostic, hover, and definition in lowered
 *   coordinates and require a second source-map hop to get back. Only the
 *   generated-TypeScript pass reads the lowered text, because that pass already
 *   owns a map. Measured equal on the corpus: all 10 `16-comptime` cases
 *   publish exactly what `smithers check` reports.
 * - Hover and definition are synchronous replies and do not run the compile
 *   stages. They reuse the asset modules the last diagnostics pass produced for
 *   the same buffers; a hover that races the very first pass analyzes without
 *   them, which can only lose an asset module's type, never invent an error.
 * - Definition resolution is by declared name within that closure, not by
 *   checker symbol identity; an ambiguous name resolves to nothing rather than
 *   to a guess.
 */

const SERVER_NAME = "smithers-lsp";
const SERVER_VERSION = "0.0.1";

/** Largest single JSON-RPC message accepted from the client. */
const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
/** Largest header block accepted before a message body. */
const MAX_HEADER_BYTES = 8 * 1024;
const MAX_PROJECT_FILES = 256;
const MAX_PROJECT_BYTES = 8 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* Protocol shapes                                                             */
/* -------------------------------------------------------------------------- */

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface RequestMessage {
  readonly jsonrpc: "2.0";
  readonly id: number | string;
  readonly method: string;
  readonly params?: JsonValue;
}

interface NotificationMessage {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: JsonValue;
}

const ERROR_PARSE = -32700;
const ERROR_INVALID_REQUEST = -32600;
const ERROR_METHOD_NOT_FOUND = -32601;
const ERROR_INVALID_PARAMS = -32602;
const ERROR_INTERNAL = -32603;
const ERROR_SERVER_NOT_INITIALIZED = -32002;
const ERROR_INVALID_REQUEST_AFTER_SHUTDOWN = -32600;

export interface LanguageServerOptions {
  /** Defaults to `process.stdin`. */
  readonly input?: NodeJS.ReadableStream;
  /** Defaults to `process.stdout`. */
  readonly output?: NodeJS.WritableStream;
  /** Protocol-level complaints are written here. Defaults to `process.stderr`. */
  readonly errorOutput?: NodeJS.WritableStream;
}

export interface LanguageServerHandle {
  /**
   * The LSP exit code: 0 when `exit` follows `shutdown`, 1 when `exit` arrives
   * without one or the input stream ends first. The caller owns process
   * termination; the server never calls `process.exit`.
   */
  readonly closed: Promise<number>;
}

/* -------------------------------------------------------------------------- */
/* Documents and projects                                                      */
/* -------------------------------------------------------------------------- */

interface OpenDocument {
  readonly uri: string;
  readonly path: string;
  version: number;
  text: string;
}

interface LoadedProject {
  readonly rootDir: string;
  /**
   * `rootDir` with every symlink in it resolved, which is the form the compile
   * stages work in: `AssetCompiler` and `ComptimeCompiler` both `realpathSync`
   * their root, and `smithers check` canonicalizes its inputs the same way
   * before it resolves anything. A macOS temporary directory is the everyday
   * case - `/var/folders/...` and `/private/var/folders/...` name one directory
   * - and mixing the two spellings made a generated asset module unreachable
   * from the module that imports it and threw away every stage diagnostic as
   * "outside the project".
   *
   * `absoluteByName` deliberately keeps the UNRESOLVED path: it is the identity
   * the editor sent in the document URI, and a reply under any other spelling
   * is a reply about a file the client does not believe it opened.
   */
  readonly canonicalRootDir: string;
  readonly sources: readonly ProjectSource[];
  /** Project-relative source name -> absolute path, as the client spells it. */
  readonly absoluteByName: ReadonlyMap<string, string>;
  readonly truncated: boolean;
}

function isSmithersPath(path: string): boolean {
  return extname(path).toLowerCase() === ".sm";
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function isInside(root: string, file: string): boolean {
  const path = relative(root, file);
  return path !== "" && !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
}

function commonAncestor(paths: readonly string[]): string {
  if (paths.length === 0) throw new TypeError("a project needs at least one source");
  let root = dirname(paths[0]!);
  while (!paths.every((path) => isInside(root, path))) {
    const parent = dirname(root);
    if (parent === root) return root;
    root = parent;
  }
  return root;
}

/** Static module specifiers, read through TypeScript's own error recovery. */
function moduleSpecifiers(source: string, fileName: string): readonly string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names: string[] = [];
  for (const statement of file.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      names.push(statement.moduleSpecifier.text);
    }
  }
  return names;
}

/** Mirror of the CLI's authored-specifier resolution, including `./x.js` spellings. */
function resolveSmithersImport(containingFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const exact = resolve(dirname(containingFile), specifier);
  const candidates: string[] = [];
  if (exact.endsWith(".sm")) candidates.push(exact);
  else if (extname(exact) === "") candidates.push(`${exact}.sm`, join(exact, "index.sm"));
  else if (exact.endsWith(".js")) candidates.push(`${exact.slice(0, -3)}.sm`);
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

function readBoundedFile(path: string): string | undefined {
  try {
    const metadata = statSync(path);
    if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) return undefined;
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * The transitive relative-`.sm` closure of the open documents, with open
 * buffers overriding what is on disk.
 */
function loadProject(
  documents: ReadonlyMap<string, OpenDocument>,
  workspaceRoot: string | undefined,
): LoadedProject | undefined {
  const overrides = new Map<string, string>();
  const pending: string[] = [];
  for (const document of documents.values()) {
    if (!isSmithersPath(document.path)) continue;
    overrides.set(document.path, document.text);
    pending.push(document.path);
  }
  if (pending.length === 0) return undefined;

  const collected = new Map<string, string>();
  let totalBytes = 0;
  let truncated = false;
  while (pending.length > 0) {
    const path = pending.shift()!;
    if (collected.has(path)) continue;
    if (collected.size >= MAX_PROJECT_FILES) {
      truncated = true;
      break;
    }
    const text = overrides.get(path) ?? readBoundedFile(path);
    if (text === undefined) continue;
    totalBytes += Buffer.byteLength(text, "utf8");
    if (totalBytes > MAX_PROJECT_BYTES) {
      truncated = true;
      break;
    }
    collected.set(path, text);
    for (const specifier of moduleSpecifiers(text, path)) {
      const resolved = resolveSmithersImport(path, specifier);
      if (resolved && !collected.has(resolved)) pending.push(resolved);
    }
  }
  if (collected.size === 0) return undefined;

  const paths = [...collected.keys()].sort();
  const ancestor = commonAncestor(paths);
  const rootDir = workspaceRoot && paths.every((path) => isInside(workspaceRoot, path))
    ? workspaceRoot
    : ancestor;
  const sources: ProjectSource[] = [];
  const absoluteByName = new Map<string, string>();
  for (const path of paths) {
    const name = toPosix(relative(rootDir, path));
    if (name === "" || name.startsWith("..")) continue;
    sources.push({ fileName: name, source: collected.get(path)! });
    absoluteByName.set(name, path);
  }
  if (sources.length === 0) return undefined;
  let canonicalRootDir = rootDir;
  try {
    canonicalRootDir = realpathSync(rootDir);
  } catch {
    // A root that cannot be resolved is used as spelled; the stages will
    // report their own failure rather than the language server inventing one.
  }
  return { rootDir, canonicalRootDir, sources, absoluteByName, truncated };
}

/* -------------------------------------------------------------------------- */
/* Source maps                                                                 */
/* -------------------------------------------------------------------------- */

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Map([...BASE64].map((character, index) => [character, index] as const));

function decodeVlq(segment: string, start: number): readonly [number, number] {
  let value = 0;
  let shift = 0;
  let index = start;
  for (;;) {
    if (index >= segment.length || shift > 48) throw new TypeError("invalid source-map VLQ segment");
    const digit = BASE64_VALUES.get(segment[index++]!);
    if (digit === undefined) throw new TypeError("invalid source-map base64 digit");
    value += (digit & 31) * 2 ** shift;
    if (!Number.isSafeInteger(value)) throw new TypeError("source-map VLQ exceeds the safe integer range");
    if ((digit & 32) === 0) break;
    shift += 5;
  }
  const magnitude = Math.floor(value / 2);
  return [(value & 1) === 1 ? -magnitude : magnitude, index];
}

interface OriginalPosition {
  readonly source: string;
  readonly line: number;
  readonly column: number;
}

/**
 * Nearest preceding mapping for a generated position, in the compiler's own
 * version-3 maps. Deliberately fail-closed: an unmapped generated position (a
 * compiler-only helper line) yields `undefined` rather than a misleading
 * authored anchor.
 */
function originalPosition(sourceMap: string, line: number, column: number): OriginalPosition | undefined {
  const parsed: unknown = JSON.parse(sourceMap);
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const map = parsed as { version?: unknown; mappings?: unknown; sources?: unknown };
  if (map.version !== 3 || typeof map.mappings !== "string" || !Array.isArray(map.sources)) return undefined;
  const sources = map.sources.filter((entry): entry is string => typeof entry === "string");
  if (sources.length !== map.sources.length) return undefined;

  let previousSource = 0;
  let previousLine = 0;
  let previousColumn = 0;
  let selected: { generatedColumn: number; source: number; line: number; column: number } | undefined;
  const lines = map.mappings.split(";");
  for (let generatedLine = 0; generatedLine < lines.length; generatedLine += 1) {
    if (generatedLine === line) selected = undefined;
    let previousGeneratedColumn = 0;
    const encoded = lines[generatedLine]!;
    for (const segment of encoded === "" ? [] : encoded.split(",")) {
      const values: number[] = [];
      for (let offset = 0; offset < segment.length;) {
        const [value, next] = decodeVlq(segment, offset);
        values.push(value);
        offset = next;
      }
      if (values.length !== 1 && values.length !== 4 && values.length !== 5) return undefined;
      previousGeneratedColumn += values[0]!;
      if (values.length === 1) {
        if (generatedLine === line && previousGeneratedColumn <= column) selected = undefined;
        continue;
      }
      previousSource += values[1]!;
      previousLine += values[2]!;
      previousColumn += values[3]!;
      if (previousSource < 0 || previousSource >= sources.length || previousLine < 0 || previousColumn < 0) {
        return undefined;
      }
      if (generatedLine === line && previousGeneratedColumn <= column) {
        selected = {
          generatedColumn: previousGeneratedColumn,
          source: previousSource,
          line: previousLine,
          column: previousColumn,
        };
      }
    }
    if (generatedLine >= line) break;
  }
  if (!selected) return undefined;
  return {
    source: sources[selected.source]!,
    line: selected.line,
    column: selected.column + column - selected.generatedColumn,
  };
}

/* -------------------------------------------------------------------------- */
/* Text positions                                                              */
/* -------------------------------------------------------------------------- */

interface LspPosition {
  readonly line: number;
  readonly character: number;
}

interface LspRange {
  readonly start: LspPosition;
  readonly end: LspPosition;
}

function lineStarts(text: string): readonly number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charCodeAt(index);
    if (character === 13) {
      if (text.charCodeAt(index + 1) === 10) index += 1;
      starts.push(index + 1);
    } else if (character === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function offsetAt(text: string, position: LspPosition): number {
  const starts = lineStarts(text);
  if (position.line < 0) return 0;
  if (position.line >= starts.length) return text.length;
  return Math.max(0, Math.min(text.length, starts[position.line]! + Math.max(0, position.character)));
}

function positionAt(text: string, offset: number): LspPosition {
  const bounded = Math.max(0, Math.min(offset, text.length));
  const starts = lineStarts(text);
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle]! <= bounded) low = middle;
    else high = middle - 1;
  }
  return { line: low, character: bounded - starts[low]! };
}

function wholeDocumentRange(text: string): LspRange {
  return { start: { line: 0, character: 0 }, end: positionAt(text, text.length) };
}

/** The token covering `offset`, so a diagnostic gets a real span rather than a caret. */
function tokenRangeAt(text: string, offset: number): LspRange {
  const token = smithersTokenAt(text, offset);
  if (token && token.start <= offset) {
    return { start: positionAt(text, token.start), end: positionAt(text, token.end) };
  }
  return {
    start: positionAt(text, offset),
    end: positionAt(text, Math.min(text.length, offset + 1)),
  };
}

/** The identifier-shaped token covering `offset`, or undefined. */
function identifierAt(text: string, offset: number): { text: string; start: number; end: number } | undefined {
  const token = smithersTokenAt(text, offset);
  if (!token || !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(token.text)) return undefined;
  return { text: token.text, start: token.start, end: token.end };
}

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                 */
/* -------------------------------------------------------------------------- */

interface PublishedDiagnostic {
  readonly range: LspRange;
  readonly severity: 1 | 2;
  readonly code: string;
  readonly source: "smithers";
  readonly message: string;
}

function severityOf(diagnostic: { readonly severity: "error" | "warning" }): 1 | 2 {
  return diagnostic.severity === "error" ? 1 : 2;
}

function smithersDiagnosticToLsp(text: string, diagnostic: SmithersDiagnostic): PublishedDiagnostic {
  return {
    range: tokenRangeAt(text, diagnostic.start),
    severity: severityOf(diagnostic),
    code: diagnostic.code,
    source: "smithers",
    message: diagnostic.message,
  };
}

/**
 * A stage diagnostic anchored by 1-based line and column rather than by offset,
 * which is the shape both compile stages report.
 */
function stageDiagnosticToLsp(
  text: string,
  diagnostic: {
    readonly code: string;
    readonly severity: "error" | "warning";
    readonly message: string;
    readonly line: number;
    readonly column: number;
  },
): PublishedDiagnostic {
  const offset = offsetAt(text, { line: diagnostic.line - 1, character: diagnostic.column - 1 });
  return {
    range: tokenRangeAt(text, offset),
    severity: severityOf(diagnostic),
    code: diagnostic.code,
    source: "smithers",
    message: diagnostic.message,
  };
}

/* -------------------------------------------------------------------------- */
/* Compile stages that run before the row pass                                 */
/* -------------------------------------------------------------------------- */

/**
 * The compile stages `smithers check` runs before the row pass, in its order.
 *
 * Both are content-addressed and cache into the system temporary directory, so
 * an unchanged buffer costs a cache lookup rather than a re-evaluation. The
 * cache namespace is the language server's own: an editor session can never
 * write into a cache a `smithers build` is reading.
 */
interface StagedProject {
  /** Compiler-generated asset modules the checker must be able to resolve. */
  readonly assetModules: readonly CompiledSourceAssetModule[];
  /**
   * Where each generated asset module is placed in the emitted tree, so that
   * `compileProject` rewrites `./system.txt` to the generated module and the
   * stock checker resolves it. Without the rewrite the emitted module still
   * names the raw asset, which TypeScript cannot resolve at all: a valid bytes,
   * Markdown or MDX import drew TS2307, and a JSON import drew the widened
   * types of TypeScript's own `resolveJsonModule` instead of the loader's.
   */
  readonly assetOutputs: readonly {
    readonly sourceFileName: string;
    readonly outputFileName: string;
    readonly resolutionAliases: readonly string[];
    readonly stripImportAttributes: true;
  }[];
  /** Comptime-lowered text per project-relative source name. */
  readonly loweredSources: readonly ProjectSource[];
  /** Lowered-to-authored map per source name; absent when nothing was lowered. */
  readonly loweringMaps: ReadonlyMap<string, string>;
}

/** Compiler-owned directory the generated asset modules are addressed under. */
const GENERATED_ASSET_DIRECTORY = "__smithers_assets__";

type StageOutcome =
  | { readonly ok: true; readonly staged: StagedProject }
  /** The stage refused. The CLI publishes exactly these and runs nothing later. */
  | { readonly ok: false; readonly byFile: ReadonlyMap<string, PublishedDiagnostic[]> };

function stageCacheDirectory(kind: "source-asset" | "comptime", rootDir: string): string {
  const identity = digest({
    schema: `smithers.lsp-${kind}-cache/v1`,
    projectRoot: rootDir,
    target: "node-es2022",
    frontend: LSP_FRONTEND,
  });
  return resolve(tmpdir(), `smithers-lsp-${kind}-cache-v1`, identity);
}

const LSP_FRONTEND = "smithers-lsp@1";

/**
 * Run the source-asset and comptime stages over the loaded project. A refusal
 * from either is returned on its own, because that is exactly what the CLI
 * publishes: `compileSmithersFiles` returns the stage's diagnostics without
 * reaching the row pass, so a language server that ran the row pass anyway
 * would publish a rule `check` never prints.
 */
async function stageProject(
  project: LoadedProject,
  byFileTemplate: () => Map<string, PublishedDiagnostic[]>,
  textByName: ReadonlyMap<string, string>,
  log: (message: string) => void,
): Promise<StageOutcome> {
  const assetCompiler = new AssetCompiler({
    root: project.canonicalRootDir,
    cacheDirectory: stageCacheDirectory("source-asset", project.canonicalRootDir),
    target: "node-es2022",
    options: { frontend: LSP_FRONTEND },
  });
  const assets = await compileSourceAssetModules({
    compiler: assetCompiler,
    sources: project.sources,
  });
  if (!assets.ok) {
    const byFile = byFileTemplate();
    for (const diagnostic of assets.diagnostics) {
      // The stage answers in its own canonical root, which is the one place
      // these two spellings of the project root have to be reconciled.
      const name = toPosix(relative(assetCompiler.root, resolve(assetCompiler.root, diagnostic.fileName)));
      const text = textByName.get(name);
      const bucket = byFile.get(name);
      if (text === undefined || !bucket) {
        log(`source-asset diagnostic names a file outside the project: ${diagnostic.fileName}`);
        continue;
      }
      bucket.push(stageDiagnosticToLsp(text, diagnostic));
    }
    return { ok: false, byFile };
  }

  const comptime = await compileComptimeIntrinsics({
    compiler: new ComptimeCompiler({
      root: project.canonicalRootDir,
      cacheDirectory: stageCacheDirectory("comptime", project.canonicalRootDir),
      target: "node-es2022",
      options: { frontend: LSP_FRONTEND },
    }),
    sources: Object.fromEntries(project.sources.map((source) => [source.fileName, source.source])),
  });
  if (!comptime.ok || !comptime.loweredFiles) {
    const byFile = byFileTemplate();
    for (const diagnostic of comptime.diagnostics) {
      const text = textByName.get(diagnostic.file);
      const bucket = byFile.get(diagnostic.file);
      if (text === undefined || !bucket) {
        log(`comptime diagnostic names a file outside the project: ${diagnostic.file}`);
        continue;
      }
      bucket.push(stageDiagnosticToLsp(text, diagnostic));
    }
    return { ok: false, byFile };
  }

  const lowered = comptime.loweredFiles;
  const loweringMaps = new Map<string, string>();
  const loweredSources = project.sources.map((source) => {
    const file = lowered[source.fileName];
    if (!file) throw new TypeError(`comptime lowering omitted project file '${source.fileName}'`);
    // A file with no comptime construct lowers to itself, and then the
    // frontend's own map already lands on authored coordinates. Only a file
    // whose text actually moved needs the second hop.
    if (file.code !== source.source) loweringMaps.set(source.fileName, file.sourceMap);
    return { fileName: source.fileName, source: file.code };
  });
  const assetOutputs = assets.modules.map((module) => ({
    sourceFileName: resolve(project.canonicalRootDir, module.sourceFileName),
    outputFileName: resolve(project.canonicalRootDir, GENERATED_ASSET_DIRECTORY, `${module.logicalKey}.ts`),
    resolutionAliases: module.resolutionAliases.map((alias) => resolve(project.canonicalRootDir, alias)),
    stripImportAttributes: true as const,
  }));
  return {
    ok: true,
    staged: { assetModules: assets.modules, assetOutputs, loweredSources, loweringMaps },
  };
}

let runtimeImportMemo: { readonly path: string | undefined } | undefined;
let schemaRuntimeImportMemo: { readonly path: string | undefined } | undefined;

function resolvePackagedModule(candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    try {
      const path = fileURLToPath(new URL(candidate, import.meta.url));
      if (existsSync(path)) return path;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Locate the packaged runtime so generated modules type-check against it. When
 * it cannot be found, the generated-TypeScript pass is skipped and only
 * Smithers frontend diagnostics are published; nothing is reported as an error
 * that the frontend did not actually find.
 */
function resolveRuntimeImport(): string | undefined {
  runtimeImportMemo ??= { path: resolvePackagedModule(["../runtime/index.js", "../runtime/index.ts"]) };
  return runtimeImportMemo.path;
}

/**
 * The derived-schema seam is the same problem one module over.
 *
 * A file that derives a schema is lowered with an added
 * `import { __vsSchema } from "smthrs/schema-runtime"`, and unlike the runtime
 * seam the editor pass never told the checker where that package lives. A bare
 * `smthrs/...` specifier resolves only from an installed consumer, so an editor
 * open on this repository reported TS2307 on a program `smithers check`
 * accepts. Resolving it here — rather than rewriting the specifier out of the
 * checked text — keeps the editor checking the bytes the compiler emits.
 */
function resolveSchemaRuntimeImport(): string | undefined {
  schemaRuntimeImportMemo ??= {
    path: resolvePackagedModule(["../build/schema-runtime.js", "../build/schema-runtime.ts"]),
  };
  return schemaRuntimeImportMemo.path;
}

let analysisMemo: {
  readonly rootDir: string;
  readonly sources: readonly ProjectSource[];
  readonly assetModules: readonly CompiledSourceAssetModule[];
  readonly analysis: ProjectAnalysis;
} | undefined;

function sameSources(
  cached: { readonly rootDir: string; readonly sources: readonly ProjectSource[] } | undefined,
  project: LoadedProject,
): boolean {
  return cached !== undefined && cached.rootDir === project.rootDir &&
    cached.sources.length === project.sources.length &&
    cached.sources.every((source, index) =>
      source.fileName === project.sources[index]!.fileName &&
      source.source === project.sources[index]!.source);
}

/**
 * Diagnostics, hover, and definition all need the same whole-project pass, and
 * an editor asks for them against the same buffers. Keying the memo on the
 * exact source set keeps every reply consistent with the diagnostics on screen
 * and keeps hover from paying for a second analysis of unchanged text.
 *
 * `assetModules` is part of the identity, not just an input: an analysis run
 * before the asset stage had produced the generated modules sees an asset
 * import as an unresolved foreign module, and reusing that for hover would
 * contradict the diagnostics on screen.
 */
function analyzeProjectMemoized(
  project: LoadedProject,
  assetModules: readonly CompiledSourceAssetModule[],
): ProjectAnalysis {
  const cached = analysisMemo;
  if (sameSources(cached, project) && cached!.assetModules.length === assetModules.length &&
    cached!.assetModules.every((module, index) => module === assetModules[index])) {
    return cached!.analysis;
  }
  const analysis = analyzeProject(project.sources, {
    rootDir: project.canonicalRootDir,
    additionalRuntimeSources: assetModules,
  });
  analysisMemo = { rootDir: project.rootDir, sources: project.sources, assetModules, analysis };
  return analysis;
}

/**
 * The asset modules the most recent diagnostics pass produced for this exact
 * source set. Hover and definition are synchronous replies and must not run the
 * compile stages themselves; reusing the last pass's modules keeps them
 * consistent with what is on screen. A miss (a hover that raced the first
 * diagnostics pass) analyzes without them rather than blocking.
 */
let stagedAssetMemo: {
  readonly rootDir: string;
  readonly sources: readonly ProjectSource[];
  readonly assetModules: readonly CompiledSourceAssetModule[];
} | undefined;

function stagedAssetModulesFor(project: LoadedProject): readonly CompiledSourceAssetModule[] {
  return sameSources(stagedAssetMemo, project) ? stagedAssetMemo!.assetModules : [];
}

interface ProjectDiagnostics {
  /** Project-relative source name -> diagnostics. */
  readonly byFile: ReadonlyMap<string, readonly PublishedDiagnostic[]>;
  readonly analysis: ProjectAnalysis | undefined;
  readonly project: LoadedProject | undefined;
}

async function computeProjectDiagnostics(
  documents: ReadonlyMap<string, OpenDocument>,
  workspaceRoot: string | undefined,
  log: (message: string) => void,
): Promise<ProjectDiagnostics> {
  const project = loadProject(documents, workspaceRoot);
  if (!project) return { byFile: new Map(), analysis: undefined, project: undefined };
  const freshByFile = (): Map<string, PublishedDiagnostic[]> => {
    const buckets = new Map<string, PublishedDiagnostic[]>();
    for (const source of project.sources) buckets.set(source.fileName, []);
    return buckets;
  };
  const textByName = new Map(project.sources.map((source) => [source.fileName, source.source] as const));
  const projectFailure = (stage: string, message: string): ProjectDiagnostics => {
    log(`${stage} failed: ${message}`);
    const buckets = freshByFile();
    for (const bucket of buckets.values()) {
      bucket.push({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        severity: 1,
        code: "SMITHERS_LSP_PROJECT",
        source: "smithers",
        message: `the Smithers project could not be analyzed: ${message}`,
      });
    }
    return { byFile: buckets, analysis: undefined, project };
  };

  let outcome: StageOutcome;
  try {
    outcome = await stageProject(project, freshByFile, textByName, log);
  } catch (error) {
    return projectFailure("compile stages", error instanceof Error ? error.message : String(error));
  }
  if (!outcome.ok) return { byFile: outcome.byFile, analysis: undefined, project };
  const staged = outcome.staged;
  stagedAssetMemo = {
    rootDir: project.rootDir,
    sources: project.sources,
    assetModules: staged.assetModules,
  };

  const byFile = freshByFile();
  let analysis: ProjectAnalysis;
  try {
    analysis = analyzeProjectMemoized(project, staged.assetModules);
  } catch (error) {
    return projectFailure("analyzeProject", error instanceof Error ? error.message : String(error));
  }

  for (const diagnostic of analysis.diagnostics) {
    const text = textByName.get(diagnostic.fileName);
    const bucket = byFile.get(diagnostic.fileName);
    if (text === undefined || !bucket) continue;
    bucket.push(smithersDiagnosticToLsp(text, diagnostic));
  }

  const hasErrors = analysis.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const runtimeImport = resolveRuntimeImport();
  if (!hasErrors && runtimeImport !== undefined) {
    try {
      // `outDir` is the project root so that relative non-`.sm` imports keep
      // resolving exactly as authored. Nothing is written: `compileProject` and
      // `checkEmittedProject` are in-memory APIs.
      // The generated modules are cut from the COMPTIME-LOWERED text, exactly as
      // the CLI cuts them, so `comptime(...)` is already the value it evaluated
      // to and the compiler-owned `smithers:comptime` import is gone. Checking
      // the authored text instead reported TS2307 on a program `check` accepts.
      const compiled = compileProject(staged.loweredSources, {
        rootDir: project.canonicalRootDir,
        outDir: project.canonicalRootDir,
        outputExtension: ".ts",
        runtimeImport,
        sourceMap: true,
        additionalRuntimeSources: staged.assetModules,
        additionalRuntimeOutputs: staged.assetOutputs,
      });
      const emitted = Object.values(compiled.files);
      const schemaRuntimeImport = resolveSchemaRuntimeImport();
      const checked = checkEmittedProject([
        ...emitted.map((file) => ({ fileName: file.outputFileName, code: file.code })),
        ...staged.assetModules.map((module, index) => ({
          fileName: staged.assetOutputs[index]!.outputFileName,
          code: module.source,
        })),
      ], {
        moduleOverrides: {
          [DEFAULT_RUNTIME_IMPORT]: runtimeImport,
          ...(schemaRuntimeImport === undefined
            ? {}
            : { [DEFAULT_SCHEMA_RUNTIME_IMPORT]: schemaRuntimeImport }),
        },
      });
      for (const diagnostic of checked) {
        if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
        if (!diagnostic.file || diagnostic.start === undefined) continue;
        const generatedName = resolve(diagnostic.file.fileName);
        const owner = emitted.find((file) => resolve(file.outputFileName) === generatedName);
        if (!owner?.sourceMap) continue;
        const generated = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        // Generated -> lowered is the frontend's own map. Lowered -> authored is
        // the comptime map, and only files whose text actually moved carry one.
        const loweringMap = staged.loweringMaps.get(owner.fileName);
        let mapped: OriginalPosition | undefined;
        try {
          const toAuthored = loweringMap === undefined
            ? owner.sourceMap
            : composeSourceMaps(owner.sourceMap, loweringMap, owner.outputFileName);
          mapped = originalPosition(toAuthored, generated.line, generated.character);
        } catch {
          mapped = undefined;
        }
        if (!mapped) continue;
        const text = textByName.get(mapped.source);
        const bucket = byFile.get(mapped.source);
        if (text === undefined || !bucket) continue;
        const offset = offsetAt(text, { line: mapped.line, character: mapped.column });
        bucket.push({
          range: tokenRangeAt(text, offset),
          severity: 1,
          code: `TS${diagnostic.code}`,
          source: "smithers",
          message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        });
      }
    } catch (error) {
      log(`generated TypeScript check failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (project.truncated) {
    for (const bucket of byFile.values()) {
      bucket.push({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        severity: 2,
        code: "SMITHERS_LSP_PROJECT_TRUNCATED",
        source: "smithers",
        message: `the project exceeded the language server's ${MAX_PROJECT_FILES}-module / ${MAX_PROJECT_BYTES}-byte bound, so diagnostics are incomplete`,
      });
    }
  }

  for (const bucket of byFile.values()) {
    bucket.sort((left, right) =>
      left.range.start.line - right.range.start.line ||
      left.range.start.character - right.range.start.character ||
      (left.code < right.code ? -1 : left.code > right.code ? 1 : 0));
  }
  return { byFile, analysis, project };
}

/* -------------------------------------------------------------------------- */
/* Hover                                                                       */
/* -------------------------------------------------------------------------- */

const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  plain: "plain",
  result: "Result",
};

function rowText(members: readonly string[]): string {
  return members.length === 0
    ? "_none_"
    : [...members].sort().map((member) => `\`${member}\``).join(", ");
}

/**
 * The hover no other editor can produce: the checked channel plus the inferred
 * failure and requirement rows of the function under the cursor.
 */
function hoverMarkdown(text: string, file: ProjectFileAnalysis, offset: number): {
  contents: string;
  range: LspRange;
} | undefined {
  const containing = file.functions
    .filter((declaration) => declaration.start <= offset && offset < declaration.end)
    .sort((left, right) => (right.end - right.start) - (left.end - left.start))
    .pop();
  if (containing) {
    const rows = file.rows[containing.name] ?? { failures: [], requirements: [] };
    const signature = text.slice(containing.start, containing.bodyStart).trim().replace(/\s*\{$/u, "");
    const channel = CHANNEL_LABELS[containing.channel] ?? containing.channel;
    const contents = [
      "```smithers",
      signature,
      "```",
      "",
      `**channel** \`${channel}\``,
      "",
      `**failures** ${rowText(rows.failures)}`,
      "",
      `**requirements** ${rowText(rows.requirements)}`,
    ].join("\n");
    return {
      contents,
      range: {
        start: positionAt(text, containing.start),
        end: positionAt(text, Math.min(containing.bodyStart, containing.end)),
      },
    };
  }

  const error = file.errors.find((declaration) => declaration.start <= offset && offset < declaration.end);
  if (error) {
    const contents = [
      "```smithers",
      `class ${error.name} extends Error`,
      "```",
      "",
      `**failure identity** \`${error.name}\``,
      "",
      error.fieldsSource.trim().length === 0
        ? "**fields** _none_"
        : `**fields** \`${error.fieldsSource.trim()}\``,
    ].join("\n");
    return {
      contents,
      range: { start: positionAt(text, error.start), end: positionAt(text, error.end) },
    };
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Definition                                                                  */
/* -------------------------------------------------------------------------- */

interface DefinitionLocation {
  readonly uri: string;
  readonly range: LspRange;
}

function declarationLocation(
  project: LoadedProject,
  analysis: ProjectAnalysis,
  fileName: string,
  name: string,
): DefinitionLocation | undefined {
  const file = analysis.files[fileName];
  const path = project.absoluteByName.get(fileName);
  const source = project.sources.find((candidate) => candidate.fileName === fileName);
  if (!file || !path || !source) return undefined;
  const fn = file.functions.find((declaration) => declaration.name === name);
  if (fn) {
    return {
      uri: pathToFileURL(path).href,
      range: {
        start: positionAt(source.source, fn.start),
        end: positionAt(source.source, Math.min(fn.bodyStart, fn.end)),
      },
    };
  }
  const error = file.errors.find((declaration) => declaration.name === name);
  if (error) {
    return {
      uri: pathToFileURL(path).href,
      range: {
        start: positionAt(source.source, error.start),
        end: positionAt(source.source, error.end),
      },
    };
  }
  return undefined;
}

function definitionAt(
  project: LoadedProject,
  analysis: ProjectAnalysis,
  fileName: string,
  text: string,
  offset: number,
): DefinitionLocation | undefined {
  const path = project.absoluteByName.get(fileName);
  if (!path) return undefined;

  // A relative `.sm` module specifier jumps to that module.
  const parsed = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!specifier || !ts.isStringLiteral(specifier)) continue;
    if (offset < specifier.getStart(parsed) || offset >= specifier.getEnd()) continue;
    const resolved = resolveSmithersImport(path, specifier.text);
    if (!resolved) return undefined;
    return {
      uri: pathToFileURL(resolved).href,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    };
  }

  const identifier = identifierAt(text, offset);
  if (!identifier) return undefined;

  const local = declarationLocation(project, analysis, fileName, identifier.text);
  if (local && !(local.uri === pathToFileURL(path).href &&
    offsetAt(text, local.range.start) <= offset && offset < offsetAt(text, local.range.end))) {
    return local;
  }

  // Follow the module's own relative `.sm` imports before searching wider.
  const imported: string[] = [];
  for (const specifier of moduleSpecifiers(text, path)) {
    const resolved = resolveSmithersImport(path, specifier);
    if (!resolved) continue;
    for (const [name, candidate] of project.absoluteByName) {
      if (candidate === resolved) imported.push(name);
    }
  }
  for (const name of imported) {
    const found = declarationLocation(project, analysis, name, identifier.text);
    if (found) return found;
  }

  const matches: DefinitionLocation[] = [];
  for (const name of project.absoluteByName.keys()) {
    if (name === fileName) continue;
    const found = declarationLocation(project, analysis, name, identifier.text);
    if (found) matches.push(found);
  }
  return matches.length === 1 ? matches[0] : local;
}

/* -------------------------------------------------------------------------- */
/* Server                                                                      */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uriToPath(uri: unknown): string | undefined {
  if (typeof uri !== "string" || !uri.startsWith("file:")) return undefined;
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

function positionFrom(value: unknown): LspPosition | undefined {
  if (!isRecord(value)) return undefined;
  const { line, character } = value;
  if (typeof line !== "number" || typeof character !== "number") return undefined;
  if (!Number.isInteger(line) || !Number.isInteger(character) || line < 0 || character < 0) return undefined;
  return { line, character };
}

export function startSmithersLanguageServer(options: LanguageServerOptions = {}): LanguageServerHandle {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const errorOutput = options.errorOutput ?? process.stderr;

  const documents = new Map<string, OpenDocument>();
  const publishedUris = new Set<string>();
  let workspaceRoot: string | undefined;
  let initialized = false;
  let shutdownRequested = false;
  let finished = false;
  let resolveClosed: (code: number) => void;
  const closed = new Promise<number>((resolveWith) => { resolveClosed = resolveWith; });

  const log = (message: string): void => {
    try {
      errorOutput.write(`[${SERVER_NAME}] ${message}\n`);
    } catch {
      // A closed stderr must not take the server down.
    }
  };

  const send = (message: Record<string, unknown>): void => {
    const body = JSON.stringify(message);
    output.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  };

  const respond = (id: number | string | null, result: unknown): void => {
    send({ jsonrpc: "2.0", id, result: result === undefined ? null : result });
  };

  const respondError = (id: number | string | null, code: number, message: string): void => {
    send({ jsonrpc: "2.0", id, error: { code, message } });
  };

  const finish = (code: number): void => {
    if (finished) return;
    finished = true;
    resolveClosed(code);
  };

  /**
   * The compile stages are asynchronous, so a refresh is too. Chaining them
   * keeps publication in edit order: two overlapping passes could otherwise
   * publish an older buffer's diagnostics last, which is the one way a
   * language server can show an error for text that is no longer on screen.
   */
  let refreshQueue: Promise<void> = Promise.resolve();

  const publishDiagnostics = async (): Promise<void> => {
    if (finished) return;
    const computed = await computeProjectDiagnostics(documents, workspaceRoot, log);
    if (finished) return;
    const nextUris = new Set<string>();
    if (computed.project) {
      for (const [fileName, diagnostics] of computed.byFile) {
        const path = computed.project.absoluteByName.get(fileName);
        if (!path) continue;
        const uri = pathToFileURL(path).href;
        const isOpen = [...documents.values()].some((document) => document.path === path);
        if (!isOpen && diagnostics.length === 0) continue;
        nextUris.add(uri);
        const version = [...documents.values()].find((document) => document.path === path)?.version;
        send({
          jsonrpc: "2.0",
          method: "textDocument/publishDiagnostics",
          params: { uri, ...(version === undefined ? {} : { version }), diagnostics },
        });
      }
    }
    for (const uri of publishedUris) {
      if (nextUris.has(uri)) continue;
      send({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: { uri, diagnostics: [] },
      });
    }
    publishedUris.clear();
    for (const uri of nextUris) publishedUris.add(uri);
  };

  const refreshDiagnostics = (): void => {
    refreshQueue = refreshQueue.then(publishDiagnostics).catch((error: unknown) => {
      log(`publishing diagnostics failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  const analysisFor = (path: string): {
    project: LoadedProject;
    analysis: ProjectAnalysis;
    fileName: string;
  } | undefined => {
    const project = loadProject(documents, workspaceRoot);
    if (!project) return undefined;
    let fileName: string | undefined;
    for (const [name, candidate] of project.absoluteByName) {
      if (candidate === path) fileName = name;
    }
    if (fileName === undefined) return undefined;
    try {
      return { project, analysis: analyzeProjectMemoized(project, stagedAssetModulesFor(project)), fileName };
    } catch (error) {
      log(`analyzeProject failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };

  const handleRequest = (message: RequestMessage): void => {
    const { id, method } = message;
    const params = isRecord(message.params) ? message.params : {};

    if (method === "initialize") {
      if (initialized) {
        respondError(id, ERROR_INVALID_REQUEST, "the server is already initialized");
        return;
      }
      initialized = true;
      const folders = params.workspaceFolders;
      if (Array.isArray(folders) && folders.length > 0 && isRecord(folders[0])) {
        workspaceRoot = uriToPath(folders[0].uri);
        if (folders.length > 1) log("only the first workspace folder is used");
      } else {
        workspaceRoot = uriToPath(params.rootUri) ??
          (typeof params.rootPath === "string" ? resolve(params.rootPath) : undefined);
      }
      respond(id, {
        capabilities: {
          positionEncoding: "utf-16",
          textDocumentSync: { openClose: true, change: 1, save: false },
          hoverProvider: true,
          definitionProvider: true,
          documentFormattingProvider: true,
        },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
      return;
    }

    if (!initialized) {
      respondError(id, ERROR_SERVER_NOT_INITIALIZED, "the server has not been initialized");
      return;
    }
    if (shutdownRequested && method !== "shutdown") {
      respondError(id, ERROR_INVALID_REQUEST_AFTER_SHUTDOWN, "the server has been shut down");
      return;
    }

    switch (method) {
      case "shutdown": {
        shutdownRequested = true;
        respond(id, null);
        return;
      }
      case "textDocument/hover": {
        const document = documentFor(params);
        const position = positionFrom(params.position);
        if (!document || !position) {
          respondError(id, ERROR_INVALID_PARAMS, "hover requires textDocument.uri and position");
          return;
        }
        const context = analysisFor(document.path);
        const file = context ? context.analysis.files[context.fileName] : undefined;
        if (!context || !file) {
          respond(id, null);
          return;
        }
        const hover = hoverMarkdown(document.text, file, offsetAt(document.text, position));
        respond(id, hover
          ? { contents: { kind: "markdown", value: hover.contents }, range: hover.range }
          : null);
        return;
      }
      case "textDocument/definition": {
        const document = documentFor(params);
        const position = positionFrom(params.position);
        if (!document || !position) {
          respondError(id, ERROR_INVALID_PARAMS, "definition requires textDocument.uri and position");
          return;
        }
        const context = analysisFor(document.path);
        if (!context) {
          respond(id, null);
          return;
        }
        const found = definitionAt(
          context.project,
          context.analysis,
          context.fileName,
          document.text,
          offsetAt(document.text, position),
        );
        respond(id, found ?? null);
        return;
      }
      case "textDocument/formatting": {
        const document = documentFor(params);
        if (!document) {
          respondError(id, ERROR_INVALID_PARAMS, "formatting requires textDocument.uri");
          return;
        }
        const formatOptions = isRecord(params.options) ? params.options : {};
        const tabSize = typeof formatOptions.tabSize === "number" && Number.isInteger(formatOptions.tabSize) &&
          formatOptions.tabSize >= 1 && formatOptions.tabSize <= 8 ? formatOptions.tabSize : 2;
        const formatted = formatSmithersSource(document.text, {
          fileName: document.path,
          indentSize: tabSize,
        });
        if (!formatted.ok) {
          for (const diagnostic of formatted.diagnostics) log(`${document.path}: ${diagnostic.code} ${diagnostic.message}`);
          respond(id, []);
          return;
        }
        respond(id, formatted.changed
          ? [{ range: wholeDocumentRange(document.text), newText: formatted.code }]
          : []);
        return;
      }
      default: {
        respondError(id, ERROR_METHOD_NOT_FOUND, `unsupported request method '${method}'`);
      }
    }
  };

  const documentFor = (params: Record<string, unknown>): OpenDocument | undefined => {
    const textDocument = params.textDocument;
    if (!isRecord(textDocument)) return undefined;
    const uri = textDocument.uri;
    if (typeof uri !== "string") return undefined;
    return documents.get(uri);
  };

  const handleNotification = (message: NotificationMessage): void => {
    const method = message.method;
    const params = isRecord(message.params) ? message.params : {};
    switch (method) {
      case "initialized":
      case "$/cancelRequest":
      case "$/setTrace":
      case "workspace/didChangeConfiguration":
      case "textDocument/didSave":
      case "textDocument/willSave":
        return;
      case "exit": {
        finish(shutdownRequested ? 0 : 1);
        return;
      }
      case "textDocument/didOpen": {
        const textDocument = params.textDocument;
        if (!isRecord(textDocument)) return;
        const uri = textDocument.uri;
        const path = uriToPath(uri);
        if (typeof uri !== "string" || path === undefined || typeof textDocument.text !== "string") return;
        documents.set(uri, {
          uri,
          path,
          version: typeof textDocument.version === "number" ? textDocument.version : 0,
          text: textDocument.text,
        });
        refreshDiagnostics();
        return;
      }
      case "textDocument/didChange": {
        const textDocument = params.textDocument;
        if (!isRecord(textDocument) || typeof textDocument.uri !== "string") return;
        const document = documents.get(textDocument.uri);
        if (!document) return;
        const changes = params.contentChanges;
        if (!Array.isArray(changes)) return;
        for (const change of changes) {
          if (!isRecord(change) || typeof change.text !== "string") continue;
          if (change.range !== undefined) {
            log("incremental changes are not supported; the client must use full document sync");
            continue;
          }
          document.text = change.text;
        }
        if (typeof textDocument.version === "number") document.version = textDocument.version;
        refreshDiagnostics();
        return;
      }
      case "textDocument/didClose": {
        const textDocument = params.textDocument;
        if (!isRecord(textDocument) || typeof textDocument.uri !== "string") return;
        documents.delete(textDocument.uri);
        refreshDiagnostics();
        return;
      }
      default:
        log(`ignoring unsupported notification '${method}'`);
    }
  };

  const dispatch = (raw: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      respondError(null, ERROR_PARSE, "the message body is not valid JSON");
      return;
    }
    if (!isRecord(parsed) || parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") {
      const id = isRecord(parsed) && (typeof parsed.id === "number" || typeof parsed.id === "string")
        ? parsed.id
        : null;
      respondError(id, ERROR_INVALID_REQUEST, "the message is not a JSON-RPC 2.0 request or notification");
      return;
    }
    const hasId = typeof parsed.id === "number" || typeof parsed.id === "string";
    try {
      if (hasId) handleRequest(parsed as unknown as RequestMessage);
      else handleNotification(parsed as unknown as NotificationMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`request '${parsed.method}' failed: ${message}`);
      if (hasId) respondError(parsed.id as number | string, ERROR_INTERNAL, message);
    }
  };

  let buffer = Buffer.alloc(0);
  const consume = (): void => {
    for (;;) {
      const separator = buffer.indexOf("\r\n\r\n");
      if (separator < 0) {
        if (buffer.length > MAX_HEADER_BYTES) {
          log("discarding an oversized header block");
          buffer = Buffer.alloc(0);
        }
        return;
      }
      const headerText = buffer.subarray(0, separator).toString("ascii");
      const bodyStart = separator + 4;
      let contentLength = -1;
      let malformed = false;
      for (const line of headerText.split("\r\n")) {
        if (line === "") continue;
        const colon = line.indexOf(":");
        if (colon < 0) {
          malformed = true;
          continue;
        }
        const name = line.slice(0, colon).trim().toLowerCase();
        const value = line.slice(colon + 1).trim();
        if (name !== "content-length") continue;
        if (!/^[0-9]+$/u.test(value)) {
          malformed = true;
          continue;
        }
        contentLength = Number.parseInt(value, 10);
      }
      if (malformed || contentLength < 0 || contentLength > MAX_MESSAGE_BYTES) {
        log(`discarding a malformed message header: ${JSON.stringify(headerText.slice(0, 120))}`);
        respondError(null, ERROR_PARSE, "the message header is malformed or its Content-Length is out of range");
        buffer = buffer.subarray(bodyStart);
        continue;
      }
      if (buffer.length < bodyStart + contentLength) return;
      const body = buffer.subarray(bodyStart, bodyStart + contentLength).toString("utf8");
      buffer = buffer.subarray(bodyStart + contentLength);
      dispatch(body);
      if (finished) return;
    }
  };

  input.on("data", (chunk: Buffer | string) => {
    if (finished) return;
    buffer = Buffer.concat([buffer, typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk]);
    try {
      consume();
    } catch (error) {
      log(`transport failure: ${error instanceof Error ? error.message : String(error)}`);
      finish(1);
    }
  });
  input.on("end", () => { finish(shutdownRequested ? 0 : 1); });
  input.on("error", (error: Error) => {
    log(`input stream failed: ${error.message}`);
    finish(1);
  });
  if (typeof (input as { resume?: () => void }).resume === "function") {
    (input as { resume: () => void }).resume();
  }

  return { closed };
}
