import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Cli, z } from "incur";
import ts from "typescript-js";

import {
  analyzeProject,
  analyzeSource,
  checkEmittedProject,
  composeSourceMaps,
  compileProject,
  emitProjectDeclarations,
  formatSmithersSource,
  startSmithersLanguageServer,
} from "../poc/dist/language/index.js";
import {
  AssetCompiler,
  ComptimeCompiler,
  compileComptimeIntrinsics,
  compileSourceAssetModules,
  DEFAULT_SCHEMA_RUNTIME_IMPORT,
  digest as comptimeDigest,
  type AssetDependency,
  type ComptimeLoweringProvenance,
} from "../poc/dist/build/index.js";
import {
  compileDurableSource,
  type DurableSourceActionBinding,
} from "../poc/dist/durable/source-compiler.js";
import { resolveTypeScriptCompiler, runTypeScriptCompiler } from "./compiler-process.js";
import {
  GoBackendFailure,
  invokeGoBackend,
  resolveGoDiagnosticFile,
  type GoBackendDiagnostic,
} from "./go-backend.js";
import {
  buildRelativeRuntimeGraph,
  transpileRelativeRuntimeGraph,
} from "./relative-runtime-graph.js";

const version = "0.0.1";
const MAX_CLI_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_TEST_PROJECT_BYTES = 16 * 1024 * 1024;
const MAX_TEST_PROJECT_FILES = 1_024;
const DEFAULT_SMITHERS_PROJECT_BUDGET = Object.freeze({
  maximumFileBytes: MAX_CLI_SOURCE_BYTES,
  maximumTotalBytes: MAX_TEST_PROJECT_BYTES,
  maximumFiles: MAX_TEST_PROJECT_FILES,
});

const files = z.object({
  files: z.array(z.string()).optional().describe(".sm, TypeScript, or JavaScript source files"),
});

const compileOptions = z.object({
  project: z.string().optional().describe("Path to tsconfig.json or its directory"),
  target: z.string().optional().describe("JavaScript language target"),
  module: z.string().optional().describe("Generated module format"),
  moduleResolution: z.string().optional().describe("Module resolution strategy"),
  outDir: z.string().optional().describe("Output directory"),
  rootDir: z.string().optional().describe("Source root directory"),
  declaration: z.boolean().optional().describe("Generate declaration files"),
  declarationMap: z.boolean().optional().describe("Generate declaration source maps"),
  sourceMap: z.boolean().optional().describe("Generate JavaScript source maps"),
  noEmit: z.boolean().optional().describe("Type-check without emitting files"),
  strict: z.boolean().optional().describe("Enable strict type checking"),
  incremental: z.boolean().optional().describe("Save incremental build information"),
  watch: z.boolean().optional().describe("Watch input files"),
  pretty: z.boolean().optional().describe("Use color and context in diagnostics"),
  showConfig: z.boolean().optional().describe("Print resolved configuration"),
  listFilesOnly: z.boolean().optional().describe("Print inputs without compiling"),
});

const backendOption = z.enum(["js", "go"]).default("js")
  .describe("Compiler backend; Go is experimental");
const backendCompileOptions = compileOptions.extend({ backend: backendOption });

type CompileOptions = z.infer<typeof compileOptions>;

interface CliDiagnostic {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
}

/**
 * Why a result carries no `rows` key.
 *
 * An empty row map is a positive claim — "this file requires nothing and can
 * fail with nothing" — and a run that never computed rows must not be able to
 * make it. The two states are therefore different keys, not two spellings of
 * the same key: `rows: {}` says none, an absent `rows` plus `rowsUnavailable`
 * says unknown and names the reason. A programmatic consumer that reads
 * `result.rows` gets `undefined` rather than a fabricated empty answer.
 */
const GO_BACKEND_ROWS_UNAVAILABLE =
  "the go backend does not report requirement rows: the Go CompileResult protocol carries " +
  "diagnostics, artifacts, and emitSkipped only, so this run observed no rows at all. " +
  "Remedy: re-run with --backend js to observe rows.";

function rowsNotComputed(stage: string): string {
  return `requirement rows were not computed: the ${stage} stage reported errors before the row analysis ran`;
}

interface SmithersFileResult {
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

interface LoadedSmithersProject {
  readonly rootDir: string;
  readonly sources: readonly { readonly fileName: string; readonly source: string }[];
  readonly runtimeSeeds: readonly {
    readonly fileName: string;
    readonly source: string;
    readonly bytes: number;
  }[];
  readonly totalBytes: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function unsupportedSmithersOptions(
  options: CompileOptions,
  allowed: ReadonlySet<keyof CompileOptions>,
): string[] {
  return Object.entries(options)
    .filter(([name, value]) => value !== undefined && value !== false && !allowed.has(name as keyof CompileOptions))
    .map(([name]) => `--${name}`)
    .sort();
}

function compilerArgs(inputFiles: readonly string[] | undefined, options: CompileOptions): string[] {
  const args: string[] = [];
  for (const [name, value] of Object.entries(options)) {
    if (value === undefined || value === false) continue;
    args.push(`--${name}`);
    if (value !== true) args.push(String(value));
  }
  if (inputFiles) args.push(...inputFiles);
  return args;
}

function finishCompiler(status: number): undefined {
  if (status !== 0) process.exitCode = status;
  return undefined;
}

function isSmithersFile(file: string): boolean {
  return extname(file).toLowerCase() === ".sm";
}

function requireInputs(inputFiles: readonly string[] | undefined): readonly string[] {
  if (!inputFiles || inputFiles.length === 0) throw new TypeError("at least one input file is required");
  return inputFiles;
}

function requireOneInput(inputFiles: readonly string[] | undefined, command: string): string {
  const inputs = requireInputs(inputFiles);
  if (inputs.length !== 1) throw new TypeError(`${command} requires exactly one input file`);
  return inputs[0]!;
}

interface DurablePlanConfig {
  readonly fileName: string;
  readonly flowId?: string;
  readonly flowVersion?: number;
  readonly actions: readonly DurableSourceActionBinding[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPlainAsciiIdentifier(value: string): boolean {
  if (!/^[$A-Z_a-z][$0-9A-Z_a-z]*$/.test(value)) return false;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, value);
  return scanner.scan() === ts.SyntaxKind.Identifier && scanner.scan() === ts.SyntaxKind.EndOfFileToken;
}

function readBoundedUtf8File(fileName: string, maximumBytes: number, description: string): {
  readonly fileName: string;
  readonly source: string;
  readonly bytes: number;
} {
  const absolute = realpathSync(resolve(fileName));
  const descriptor = openSync(absolute, "r");
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
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${description} is not valid UTF-8`);
  }
  return { fileName: absolute, source, bytes: bytes.byteLength };
}

function assertNoDuplicateJsonKeys(source: string, fileName: string): void {
  const json = ts.parseJsonText(fileName, source);
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const names = new Set<string>();
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) continue;
        if (names.has(property.name.text)) {
          const position = json.getLineAndCharacterOfPosition(property.name.getStart(json));
          throw new TypeError(
            `durable bindings contain duplicate key ${JSON.stringify(property.name.text)} at ` +
            `${position.line + 1}:${position.character + 1}`,
          );
        }
        names.add(property.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(json);
}

function readDurablePlanConfig(fileName: string): DurablePlanConfig {
  const snapshot = readBoundedUtf8File(fileName, MAX_CLI_SOURCE_BYTES, "durable bindings file");
  const parsed: unknown = JSON.parse(snapshot.source);
  assertNoDuplicateJsonKeys(snapshot.source, snapshot.fileName);
  if (!isRecord(parsed)) throw new TypeError("durable bindings file must be one JSON object");
  const allowed = new Set(["flowId", "flowVersion", "actions"]);
  const extra = Object.keys(parsed).filter((key) => !allowed.has(key)).sort(compareText);
  if (extra.length > 0) throw new TypeError(`unknown durable bindings fields: ${extra.join(", ")}`);
  if (!Array.isArray(parsed.actions)) throw new TypeError("durable bindings file requires an actions array");
  if (parsed.flowId !== undefined && (typeof parsed.flowId !== "string" || parsed.flowId.trim() === "")) {
    throw new TypeError("durable bindings flowId must be a non-empty string");
  }
  if (parsed.flowVersion !== undefined &&
    (!Number.isSafeInteger(parsed.flowVersion) || (parsed.flowVersion as number) < 1)) {
    throw new TypeError("durable bindings flowVersion must be a positive safe integer");
  }
  for (const [index, binding] of parsed.actions.entries()) {
    if (!isRecord(binding)) throw new TypeError(`durable action binding ${index} must be an object`);
    const bindingAllowed = new Set(["moduleSpecifier", "exportName", "descriptor"]);
    const bindingExtra = Object.keys(binding).filter((key) => !bindingAllowed.has(key)).sort(compareText);
    if (bindingExtra.length > 0) {
      throw new TypeError(`unknown durable action binding ${index} fields: ${bindingExtra.join(", ")}`);
    }
    if (typeof binding.moduleSpecifier !== "string" || binding.moduleSpecifier.trim() === "") {
      throw new TypeError(`durable action binding ${index} needs moduleSpecifier`);
    }
    if (binding.moduleSpecifier === "smithers:flows") {
      throw new TypeError(`durable action binding ${index} cannot replace smithers:flows`);
    }
    if (typeof binding.exportName !== "string" || !isPlainAsciiIdentifier(binding.exportName)) {
      throw new TypeError(`durable action binding ${index} needs a non-keyword identifier exportName`);
    }
    if (!isRecord(binding.descriptor)) throw new TypeError(`durable action binding ${index} needs descriptor`);
  }
  return {
    fileName: snapshot.fileName,
    flowId: parsed.flowId as string | undefined,
    flowVersion: parsed.flowVersion as number | undefined,
    actions: parsed.actions as unknown as readonly DurableSourceActionBinding[],
  };
}

function containsMixedInputs(inputFiles: readonly string[]): boolean {
  return inputFiles.some(isSmithersFile) && inputFiles.some((file) => !isSmithersFile(file));
}

function formatTsDiagnostic(diagnostic: ts.Diagnostic, fallbackFile: string): CliDiagnostic {
  const position = diagnostic.file && diagnostic.start !== undefined
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    : undefined;
  return {
    code: `TS${diagnostic.code}`,
    severity: diagnostic.category === ts.DiagnosticCategory.Warning ? "warning" : "error",
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    file: diagnostic.file?.fileName ?? fallbackFile,
    line: position ? position.line + 1 : undefined,
    column: position ? position.character + 1 : undefined,
  };
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

function originalSourcePosition(sourceMap: string, line: number, column: number): {
  readonly source: string;
  readonly line: number;
  readonly column: number;
} {
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
  if (!selected) throw new TypeError(`diagnostic source map has no mapping for ${line + 1}:${column + 1}`);
  return {
    source: parsed.sources[selected.source] as string,
    line: selected.originalLine,
    column: selected.originalColumn + column - selected.generatedColumn,
  };
}

function remapCliDiagnostic(
  project: LoadedSmithersProject,
  sourceMap: string,
  diagnostic: CliDiagnostic,
): CliDiagnostic {
  if (diagnostic.line === undefined || diagnostic.column === undefined) return diagnostic;
  const mapped = originalSourcePosition(sourceMap, diagnostic.line - 1, diagnostic.column - 1);
  const source = project.sources.find((candidate) => candidate.fileName === mapped.source);
  if (!source) throw new TypeError(`diagnostic source map references unknown project file '${mapped.source}'`);
  return {
    ...diagnostic,
    file: resolve(project.rootDir, source.fileName),
    line: mapped.line + 1,
    column: mapped.column + 1,
  };
}

function outputPath(input: string, outDir: string | undefined, extension: ".mjs" | ".ts"): string {
  const stem = basename(input, extname(input));
  return resolve(outDir ?? dirname(input), `${stem}${extension}`);
}

/** Resolve existing ancestors so relative imports survive symlinked temp roots. */
function canonicalFuturePath(file: string): string {
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

function pathsReferToSameFile(left: string, right: string): boolean {
  const canonicalLeft = canonicalFuturePath(resolve(left));
  const canonicalRight = canonicalFuturePath(resolve(right));
  if (canonicalLeft === canonicalRight) return true;
  if (!existsSync(canonicalLeft) || !existsSync(canonicalRight)) return false;
  const leftMetadata = statSync(canonicalLeft);
  const rightMetadata = statSync(canonicalRight);
  return leftMetadata.dev === rightMetadata.dev && leftMetadata.ino === rightMetadata.ino;
}

function duplicateSmithersOutput(
  inputFiles: readonly string[],
  outDir: string | undefined,
): { readonly output: string; readonly inputs: readonly [string, string] } | undefined {
  const seen = new Set<string>();
  for (const inputName of inputFiles) {
    const input = realpathSync(resolve(inputName));
    if (seen.has(input)) {
      return { output: canonicalFuturePath(outputPath(input, outDir, ".mjs")), inputs: [input, input] };
    }
    seen.add(input);
  }
  return undefined;
}

function isInside(root: string, file: string): boolean {
  const path = relative(root, file);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}

function commonSourceRoot(files: readonly string[]): string {
  if (files.length === 0) throw new TypeError("at least one .sm source is required");
  let root = dirname(files[0]);
  while (!files.every((file) => isInside(root, file))) {
    const parent = dirname(root);
    if (parent === root) throw new TypeError(".sm sources do not share a usable source root");
    root = parent;
  }
  return root;
}

function staticModuleSpecifiers(source: string, fileName: string): readonly string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names: string[] = [];
  for (const statement of file.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
    ) names.push(statement.moduleSpecifier.text);
  }
  return names;
}

function existingFileIdentity(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const canonical = realpathSync(path);
  return statSync(canonical).isFile() ? canonical : undefined;
}

/**
 * Resolve one relative specifier written in a `.sm` source to the authored
 * Smithers module it names, or `undefined` when it names something else (a
 * foreign module, a package, a host module).
 *
 * The resolution must be deterministic: the CLI contract requires failing
 * closed when a source "cannot be resolved deterministically", and requires
 * rejecting "aliases that make one file appear under multiple identities".
 * Taking the first candidate that happens to exist satisfies neither, so both
 * ways one specifier can denote two modules are rejected here:
 *
 *   - two Smithers candidates exist (`./dep` with both `dep.sm` and
 *     `dep/index.sm`); and
 *   - a file literally exists at the written path and is not the Smithers
 *     source the emit-name convention maps it to (`./dep.js` with a real
 *     `dep.js` beside `dep.sm`). Every other extension already lets the literal
 *     file win and be checked as foreign, so silently preferring `dep.sm` here
 *     both shadowed a real module and diverged from its own sibling forms.
 */
function resolveAuthoredSmithersImport(containingFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const exact = resolve(dirname(containingFile), specifier);
  const candidates: string[] = [];
  if (exact.endsWith(".sm")) candidates.push(exact);
  else if (extname(exact) === "") candidates.push(`${exact}.sm`, join(exact, "index.sm"));
  else if (exact.endsWith(".js")) candidates.push(`${exact.slice(0, -3)}.sm`);
  const resolved = [...new Set(candidates.map(existingFileIdentity).filter((item) => item !== undefined))];
  if (resolved.length === 0) return undefined;
  if (resolved.length > 1) {
    throw new TypeError(
      `.sm import ${JSON.stringify(specifier)} in ${containingFile} does not resolve deterministically; ` +
        `it names more than one source: ${resolved.join(", ")}`,
    );
  }
  const authored = resolved[0]!;
  const literal = existingFileIdentity(exact);
  if (literal !== undefined && literal !== authored) {
    throw new TypeError(
      `.sm import ${JSON.stringify(specifier)} in ${containingFile} is ambiguous; ` +
        `it names the existing file ${literal} and also the Smithers source ${authored}`,
    );
  }
  return authored;
}

function loadSmithersProject(
  inputNames: readonly string[],
  requestedRoot?: string,
  budget: {
    readonly maximumFileBytes: number;
    readonly maximumTotalBytes: number;
    readonly maximumFiles: number;
  } = DEFAULT_SMITHERS_PROJECT_BUDGET,
): LoadedSmithersProject {
  const canonicalInputs = inputNames.map((name) => realpathSync(resolve(name)));
  const rootDir = requestedRoot
    ? realpathSync(resolve(requestedRoot))
    : commonSourceRoot(canonicalInputs);
  const pending = [...canonicalInputs];
  const sourceByAbsoluteName = new Map<string, { readonly source: string; readonly bytes: number }>();
  const identityOwners = new Map<string, string>();
  let totalBytes = 0;
  while (pending.length > 0) {
    const fileName = pending.pop()!;
    if (sourceByAbsoluteName.has(fileName)) continue;
    if (!isSmithersFile(fileName)) throw new TypeError(`project source is not .sm: ${fileName}`);
    if (!isInside(rootDir, fileName) || fileName === rootDir) {
      throw new TypeError(`.sm source is outside --rootDir: ${fileName}`);
    }
    if (sourceByAbsoluteName.size >= budget.maximumFiles) {
      throw new TypeError(`.sm project exceeds ${budget.maximumFiles} source files`);
    }
    const snapshot = readBoundedUtf8File(fileName, budget.maximumFileBytes, ".sm source");
    const source = snapshot.source;
    const metadata = statSync(fileName);
    const identity = `${metadata.dev}:${metadata.ino}`;
    const priorIdentity = identityOwners.get(identity);
    if (priorIdentity && priorIdentity !== fileName) {
      throw new TypeError(`.sm project contains hard-link aliases: ${priorIdentity} and ${fileName}`);
    }
    identityOwners.set(identity, fileName);
    totalBytes += snapshot.bytes;
    if (totalBytes > budget.maximumTotalBytes) {
      throw new TypeError(`.sm project exceeds ${budget.maximumTotalBytes} source bytes`);
    }
    sourceByAbsoluteName.set(fileName, { source, bytes: snapshot.bytes });
    for (const specifier of staticModuleSpecifiers(source, fileName)) {
      const dependency = resolveAuthoredSmithersImport(fileName, specifier);
      if (dependency) {
        if (!isInside(rootDir, dependency) || dependency === rootDir) {
          throw new TypeError(`.sm dependency is outside --rootDir: ${dependency}`);
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

function sourceAssetCompilerForProject(rootDir: string): {
  readonly cacheIdentity: string;
  readonly cacheDirectory: string;
  readonly compiler: AssetCompiler;
} {
  const cacheIdentity = comptimeDigest({
    schema: "smithers.cli-source-assets/v1",
    projectRoot: rootDir,
    target: "node-es2022",
    frontend: "smithers-root-cli@1",
  });
  const cacheDirectory = resolve(tmpdir(), "smithers-source-asset-cache-v1", cacheIdentity);
  return {
    cacheIdentity,
    cacheDirectory,
    compiler: new AssetCompiler({
      root: rootDir,
      cacheDirectory,
      target: "node-es2022",
      options: { frontend: "smithers-root-cli@1" },
    }),
  };
}

async function compileSmithersFiles(
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
    readonly declaration?: boolean;
    readonly sourceMap?: boolean;
    readonly sourceBudget?: {
      readonly maximumFileBytes: number;
      readonly maximumTotalBytes: number;
      readonly maximumFiles: number;
    };
  },
): Promise<readonly SmithersFileResult[]> {
  const project = loadSmithersProject(inputNames, options.rootDir, options.sourceBudget);
  const outDir = canonicalFuturePath(resolve(options.outDir ?? project.rootDir));
  const smithersRuntimeOutputs = project.runtimeSeeds.map((source) => ({
    sourceFileName: source.fileName,
    outputFileName: resolve(outDir, relative(project.rootDir, source.fileName).replace(/\.sm$/, ".mjs")),
  }));
  const assetContext = sourceAssetCompilerForProject(project.rootDir);
  const assetCacheIdentity = assetContext.cacheIdentity;
  const assetCacheDirectory = assetContext.cacheDirectory;
  if (isInside(outDir, assetCacheDirectory) || isInside(assetCacheDirectory, outDir)) {
    throw new TypeError(".sm --outDir must not overlap the compiler-owned source-asset cache");
  }
  const sourceAssets = await compileSourceAssetModules({
    compiler: assetContext.compiler,
    sources: project.sources,
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
    outputFileName: resolve(outDir, "__smithers_assets__", `${module.logicalKey}.mjs`),
    resolutionAliases: module.resolutionAliases.map((alias) => resolve(project.rootDir, alias)),
  }));
  const runtimeGraph = buildRelativeRuntimeGraph({
    rootDir: project.rootDir,
    outDir,
    smithersSources: project.runtimeSeeds,
    smithersOutputs: smithersRuntimeOutputs,
    generatedRuntimeSources: generatedAssetRuntimeSources,
    budget: options.sourceBudget ?? DEFAULT_SMITHERS_PROJECT_BUDGET,
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
  const cacheIdentity = comptimeDigest({
    schema: "smithers.cli-comptime-cache/v1",
    projectRoot: project.rootDir,
    target: "node-es2022",
    frontend: "smithers-root-cli@1",
  });
  const cacheDirectory = resolve(tmpdir(), "smithers-comptime-cache-v1", cacheIdentity);
  if (isInside(outDir, cacheDirectory) || isInside(cacheDirectory, outDir)) {
    throw new TypeError(".sm --outDir must not overlap the compiler-owned comptime cache");
  }
  // The derived-schema runtime is a package seam exactly like `smthrs/runtime`:
  // generated code names the bare specifier so an installed consumer resolves it,
  // and only an internal caller (run/test) redirects it at the packaged file.
  const emittedSchemaRuntime = options.schemaRuntimeImport ?? DEFAULT_SCHEMA_RUNTIME_IMPORT;
  const comptime = await compileComptimeIntrinsics({
    compiler: new ComptimeCompiler({
      root: project.rootDir,
      cacheDirectory,
      target: "node-es2022",
      options: { frontend: "smithers-root-cli@1" },
    }),
    sources: Object.fromEntries(project.sources.map((source) => [source.fileName, source.source])),
    schemaRuntimeImport: emittedSchemaRuntime,
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
  const emittedRuntime = options.runtimeImport ?? "smthrs/runtime";
  const compiled = compileProject(loweredSources, {
    rootDir: project.rootDir,
    outDir,
    outputExtension: ".mjs",
    runtimeImport: emittedRuntime,
    additionalRuntimeSources: sourceAssets.modules,
    additionalRuntimeOutputs: runtimeGraph.additionalRuntimeOutputs,
    // Internal maps are mandatory for authored diagnostic remapping even when
    // the caller did not request a JavaScript map artifact.
    sourceMap: true,
  });
  const compiledFiles = Object.values(compiled.files).map((file) => ({
    ...file,
    code: runtimeGraph.rewriteSmithersRuntimeCalls(file.code, file.absoluteFileName, file.outputFileName),
  }));
  const smithersToAuthoredMaps = new Map<string, string>();
  for (const file of compiledFiles) {
    const lowered = comptime.loweredFiles[file.fileName];
    if (!lowered || !file.sourceMap) throw new TypeError(`frontend source map is missing for ${file.fileName}`);
    smithersToAuthoredMaps.set(file.fileName, composeSourceMaps(
      file.sourceMap,
      lowered.sourceMap,
      `${file.outputFileName}.comptime.mjs`,
    ));
  }
  const results = new Map<string, SmithersFileResult>();
  const assetOutputs = new Map(generatedAssetRuntimeSources.map((module) => [
    resolve(module.sourceFileName),
    resolve(module.outputFileName),
  ]));
  for (const file of compiledFiles) {
    const lowered = comptime.loweredFiles[file.fileName]!;
    results.set(file.fileName, {
      input: file.absoluteFileName,
      output: options.emit === false ? undefined : file.outputFileName,
      diagnostics: file.analysis.diagnostics.map((diagnostic) => remapCliDiagnostic(
        project,
        lowered.sourceMap,
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
  const validationRuntime = options.runtimeImport ??
    fileURLToPath(new URL("../poc/dist/runtime/index.js", import.meta.url));
  const validationSchemaRuntime = options.schemaRuntimeImport ??
    fileURLToPath(new URL("../poc/dist/build/schema-runtime.js", import.meta.url));
  // A bare `smthrs/...` specifier only resolves from an installed consumer, so
  // the checker (and the declaration emitter behind it) reads the packaged file
  // directly. Emitted JavaScript keeps whatever the caller asked for.
  const validationCode = (file: (typeof emittedFiles)[number]): string => {
    let code = file.code;
    if (!options.runtimeImport) {
      code = code.replaceAll(JSON.stringify(emittedRuntime), JSON.stringify(validationRuntime));
    }
    if (!options.schemaRuntimeImport) {
      code = code.replaceAll(JSON.stringify(emittedSchemaRuntime), JSON.stringify(validationSchemaRuntime));
    }
    return code;
  };
  /**
   * The declaration emitter reads the checker's resolved path, so a `d.mts` can
   * quote it back as `import("<absolute>")`. A published declaration must name
   * the package seam instead of this machine, so the substitution above is
   * undone on the way out.
   */
  const restorePackageSpecifiers = (code: string): string => {
    let restored = code;
    const seams: readonly (readonly [string, string])[] = [
      ...(options.runtimeImport ? [] : [[validationRuntime, emittedRuntime] as const]),
      ...(options.schemaRuntimeImport ? [] : [[validationSchemaRuntime, emittedSchemaRuntime] as const]),
    ];
    for (const [resolved, seam] of seams) {
      restored = restored
        .replaceAll(JSON.stringify(resolved), JSON.stringify(seam))
        .replaceAll(JSON.stringify(resolved.replace(/\.js$/, "")), JSON.stringify(seam));
    }
    return restored;
  };
  const foreign = transpileRelativeRuntimeGraph(runtimeGraph, { sourceMap: options.sourceMap });
  for (const diagnostic of foreign.diagnostics) {
    const diagnosticName = diagnostic.file ? resolve(diagnostic.file.fileName) : undefined;
    const foreignFile = diagnosticName
      ? foreign.files.find((candidate) => resolve(candidate.fileName) === diagnosticName)
      : undefined;
    const result = results.values().next().value as SmithersFileResult | undefined;
    if (result) {
      (result.diagnostics as CliDiagnostic[]).push(formatTsDiagnostic(
        diagnostic,
        foreignFile?.fileName ?? "<relative runtime graph>",
      ));
    }
  }

  if (![...results.values()].some((result) =>
    result.diagnostics.some((diagnostic) => diagnostic.severity === "error"))) {
    const validation = checkEmittedProject([
      ...emittedFiles.map((file) => ({
        fileName: file.outputFileName,
        code: validationCode(file),
      })),
      ...foreign.files.map((file) => ({ fileName: file.outputFileName, code: file.validationCode })),
    ]);
    for (const diagnostic of validation) {
      if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
      const output = diagnostic.file ? resolve(diagnostic.file.fileName) : undefined;
      const file = output ? emittedFiles.find((candidate) => resolve(candidate.outputFileName) === output) : undefined;
      const foreignFile = output
        ? foreign.files.find((candidate) => resolve(candidate.outputFileName) === output)
        : undefined;
      const result = file ? results.get(file.fileName) : results.values().next().value as SmithersFileResult | undefined;
      if (result) {
        const formatted = formatTsDiagnostic(
          diagnostic,
          file?.absoluteFileName ?? foreignFile?.fileName ?? "<project>",
        );
        (result.diagnostics as CliDiagnostic[]).push(file
          ? remapCliDiagnostic(project, smithersToAuthoredMaps.get(file.fileName)!, formatted)
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
        code: validationCode(file),
        effects: file.analysis.rows,
      })),
      ...foreign.files.map((file) => ({
        fileName: file.outputFileName,
        code: file.declarationCode,
      })),
    ]);
    declarationOutputs = declarations.outputs.map((output) => ({
      ...output,
      code: restorePackageSpecifiers(output.code),
    }));
    for (const diagnostic of declarations.diagnostics) {
      if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
      const generated = diagnostic.file ? resolve(diagnostic.file.fileName) : undefined;
      const file = generated
        ? emittedFiles.find((candidate) => resolve(candidate.outputFileName) === generated)
        : undefined;
      const foreignFile = generated
        ? foreign.files.find((candidate) => resolve(candidate.outputFileName) === generated)
        : undefined;
      const result = file ? results.get(file.fileName) : results.values().next().value as SmithersFileResult | undefined;
      if (result) {
        const formatted = formatTsDiagnostic(
          diagnostic,
          file?.absoluteFileName ?? foreignFile?.fileName ?? "<project declaration>",
        );
        (result.diagnostics as CliDiagnostic[]).push(file
          ? remapCliDiagnostic(project, smithersToAuthoredMaps.get(file.fileName)!, formatted)
          : foreignFile ? { ...formatted, file: foreignFile.fileName } : formatted);
      }
    }
    for (const file of emittedFiles) {
      const declarationName = file.outputFileName.replace(/\.mjs$/, ".d.mts");
      const result = results.get(file.fileName)!;
      if (!declarationOutputs.some((output) => resolve(output.fileName) === resolve(declarationName))) {
        (result.diagnostics as CliDiagnostic[]).push({
          code: "SMITHERS_DECLARATION_MISSING",
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
        const result = results.values().next().value as SmithersFileResult | undefined;
        if (result) {
          (result.diagnostics as CliDiagnostic[]).push({
            code: assetSourceNames.has(resolve(file.fileName))
              ? "SMITHERS_ASSET_DECLARATION_MISSING"
              : "SMITHERS_FOREIGN_DECLARATION_MISSING",
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
      const emitted = ts.transpileModule(file.code, {
        fileName: `${file.outputFileName}.ts`,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          sourceMap: options.sourceMap,
          inlineSources: options.sourceMap,
        },
        reportDiagnostics: true,
      });
      const result = results.get(file.fileName)!;
      for (const diagnostic of emitted.diagnostics ?? []) {
        if (diagnostic.category === ts.DiagnosticCategory.Error) {
          const formatted = formatTsDiagnostic(diagnostic, file.absoluteFileName);
          (result.diagnostics as CliDiagnostic[]).push(
            remapCliDiagnostic(project, smithersToAuthoredMaps.get(file.fileName)!, formatted),
          );
        }
      }
      let javascript = emitted.outputText;
      if (options.sourceMap) {
        if (!emitted.sourceMapText || !file.sourceMap) {
          (result.diagnostics as CliDiagnostic[]).push({
            code: "SMITHERS_SOURCE_MAP_MISSING",
            severity: "error",
            message: `A source-map stage emitted no map for ${file.absoluteFileName}`,
            file: file.absoluteFileName,
          });
        } else {
          try {
            const lowered = comptime.loweredFiles[file.fileName];
            if (!lowered) throw new TypeError(`comptime source map is missing for ${file.fileName}`);
            // Composition is deliberately staged: Smithers output -> comptime
            // output -> authored sources, then JavaScript -> that combined map.
            // Smithers now preserves exact authored positions where provable and
            // token anchors across semantic rewrites; compiler-generated text
            // is explicitly unmapped rather than assigned a false position.
            const smithersToAuthored = smithersToAuthoredMaps.get(file.fileName);
            if (!smithersToAuthored) throw new TypeError(`composed frontend source map is missing for ${file.fileName}`);
            const composed = JSON.parse(composeSourceMaps(
              emitted.sourceMapText,
              smithersToAuthored,
              file.outputFileName,
            )) as { sources: string[] } & Record<string, unknown>;
            if (composed.sources.length === 0) throw new TypeError("composed .sm source map has no authored sources");
            const authoredByName = new Map(project.sources.map((source) => [
              source.fileName,
              resolve(project.rootDir, source.fileName),
            ]));
            composed.sources = composed.sources.map((source) => {
              const authored = authoredByName.get(source);
              if (!authored) throw new TypeError(`composed .sm source map references unknown source '${source}'`);
              let display = relative(dirname(file.outputFileName), authored).split(sep).join("/");
              if (!display.startsWith(".")) display = `./${display}`;
              return display;
            });
            javascriptMaps.set(file.fileName, JSON.stringify(composed));
            javascript = `${javascript.replace(/\n?\/\/# sourceMappingURL=.*(?:\r?\n)?$/, "").trimEnd()}\n` +
              `//# sourceMappingURL=${basename(file.outputFileName)}.map\n`;
          } catch (error) {
            (result.diagnostics as CliDiagnostic[]).push({
              code: "SMITHERS_SOURCE_MAP_INVALID",
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

  if (options.emit !== false &&
    ![...results.values()].some((result) => result.diagnostics.some((diagnostic) => diagnostic.severity === "error"))) {
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
    commitProjectFiles(outDir, emissions);
  }
  return [...results.values()].sort((left, right) => compareText(left.input, right.input));
}

function authoredLineColumn(source: string, offset: number): { readonly line: number; readonly column: number } {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > source.length) {
    throw new GoBackendFailure(
      "SMITHERS_GO_PROTOCOL",
      `The Go compiler returned an out-of-range authored diagnostic offset ${offset}. ` +
      "Remedy: run `npm run build` to rebuild the CLI and Go request producer together.",
    );
  }
  const before = source.slice(0, offset);
  const lastNewline = before.lastIndexOf("\n");
  return {
    line: before.split("\n").length,
    column: offset - lastNewline,
  };
}

function formatGoDiagnostic(
  project: LoadedSmithersProject,
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

function decodeGoArtifact(path: string, content: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(content, "base64"));
  } catch (error) {
    throw new GoBackendFailure(
      "SMITHERS_GO_PROTOCOL",
      `The Go compiler returned a non-UTF-8 artifact ${path}: ${error instanceof Error ? error.message : String(error)}. ` +
      "Remedy: run `npm run build` to rebuild the CLI and Go request producer together.",
    );
  }
}

function compileGoSmithersFiles(
  inputNames: readonly string[],
  options: {
    readonly outDir?: string;
    readonly rootDir?: string;
    readonly emit?: boolean;
    readonly declaration?: boolean;
    readonly sourceMap?: boolean;
  },
): readonly SmithersFileResult[] {
  const project = loadSmithersProject(inputNames, options.rootDir);
  const outDir = canonicalFuturePath(resolve(options.outDir ?? project.rootDir));
  const byLogicalName = new Map(project.sources.map((source) => [source.fileName, source]));
  const compiled = invokeGoBackend({
    rootNames: project.sources.map((source) => source.fileName),
    files: project.sources.map((source) => ({
      path: source.fileName,
      kind: "smithers" as const,
      text: source.source,
    })),
    options: {
      noEmit: options.emit === false,
      noEmitOnError: true,
      declaration: options.declaration === true,
      sourceMap: options.sourceMap === true,
      inlineSources: options.sourceMap === true,
    },
    lowering: "internal",
  });

  const diagnostics = new Map(project.sources.map((source) => [source.fileName, [] as CliDiagnostic[]]));
  const requestSources = new Set(diagnostics.keys());
  for (const diagnostic of compiled.diagnostics) {
    // A name the request never sent fails closed inside `resolveGoDiagnosticFile`
    // rather than landing on whichever source happens to be first. A diagnostic
    // that names no file at all is project-level: it goes in the first bucket so
    // it is still reported and still gates, and `formatGoDiagnostic` leaves its
    // `file` unset, so it never claims to come from that file's source.
    const logicalName = resolveGoDiagnosticFile(diagnostic.file, requestSources);
    const formatted = formatGoDiagnostic(project, byLogicalName, diagnostic);
    const target = logicalName === undefined
      ? diagnostics.values().next().value
      : diagnostics.get(logicalName);
    target?.push(formatted);
  }
  const hasError = [...diagnostics.values()].some((items) =>
    items.some((diagnostic) => diagnostic.severity === "error"));
  if (options.emit !== false && compiled.emitSkipped && !hasError) {
    diagnostics.values().next().value?.push({
      code: "SMITHERS_GO_EMIT_SKIPPED",
      severity: "error",
      message: "The Go compiler skipped emit without reporting a compiler diagnostic.",
    });
  }

  const artifacts = compiled.artifacts.map((artifact) => ({
    logicalName: artifact.path,
    fileName: resolve(outDir, artifact.path),
    code: decodeGoArtifact(artifact.path, artifact.content),
  }));
  const finalHasError = [...diagnostics.values()].some((items) =>
    items.some((diagnostic) => diagnostic.severity === "error"));
  if (options.emit !== false && !compiled.emitSkipped && !finalHasError) {
    commitProjectFiles(outDir, artifacts);
  }

  return project.sources.map((source): SmithersFileResult => {
    const runtimeName = source.fileName.replace(/\.sm$/, ".js");
    const declarationName = source.fileName.replace(/\.sm$/, ".d.sm.ts");
    const mapName = `${runtimeName}.map`;
    const emitted = artifacts.find((artifact) => artifact.logicalName === runtimeName);
    return {
      input: resolve(project.rootDir, source.fileName),
      output: options.emit !== false && !finalHasError && emitted ? emitted.fileName : undefined,
      diagnostics: diagnostics.get(source.fileName)!,
      rowsUnavailable: GO_BACKEND_ROWS_UNAVAILABLE,
      declarations: options.emit !== false && !finalHasError &&
        artifacts.some((artifact) => artifact.logicalName === declarationName)
        ? [resolve(outDir, declarationName)]
        : [],
      sourceMap: options.emit !== false && !finalHasError &&
        artifacts.some((artifact) => artifact.logicalName === mapName)
        ? resolve(outDir, mapName)
        : undefined,
    };
  }).sort((left, right) => compareText(left.input, right.input));
}

function backendFailure(context: { error(input: {
  readonly code: string;
  readonly exitCode: number;
  readonly message: string;
  readonly retryable?: boolean;
}): unknown }, error: unknown): unknown {
  if (error instanceof GoBackendFailure) {
    return context.error({ code: error.code, exitCode: 2, message: error.message, retryable: false });
  }
  return context.error({
    code: "SMITHERS_PROJECT_ERROR",
    exitCode: 2,
    message: error instanceof Error ? error.message : String(error),
  });
}

function commitProjectFiles(
  outDir: string,
  filesToWrite: readonly { readonly fileName: string; readonly code: string }[],
): void {
  const root = resolve(outDir);
  mkdirSync(root, { recursive: true });
  const rootMetadata = lstatSync(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new TypeError(`compiler outDir must be a real directory: ${root}`);
  }
  const staging = mkdtempSync(join(dirname(root), ".smithers-emit-"));
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

function reportSmithersResults(results: readonly SmithersFileResult[]): { ok: boolean; files: readonly SmithersFileResult[] } {
  const ok = results.every((result) => !result.diagnostics.some((diagnostic) => diagnostic.severity === "error"));
  if (!ok) process.exitCode = 1;
  return { ok, files: results };
}

/* -------------------------------------------------------------------------- */
/* smithers format                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Extensions the whitespace-only formatter accepts. `.sm` additionally goes
 * through Smithers construct masking; the others are ordinary TypeScript or
 * JavaScript for which the masking pass is a no-op. JSX variants are refused
 * because the formatter scans in the standard language variant.
 */
const FORMATTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".sm", ".ts", ".mts", ".cts", ".js", ".mjs", ".cjs",
]);

interface FormatFileResult {
  readonly file: string;
  readonly ok: boolean;
  readonly changed: boolean;
  readonly formatted?: string;
  readonly diagnostics: readonly CliDiagnostic[];
}

function writeFormattedFile(absolute: string, code: string): void {
  const temporary = join(
    dirname(absolute),
    `.${basename(absolute)}.smithers-format-${randomBytes(8).toString("hex")}`,
  );
  writeFileSync(temporary, code, { encoding: "utf8", flag: "wx" });
  try {
    renameSync(temporary, absolute);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function formatOneFile(input: string, indentSize: number | undefined): FormatFileResult {
  const extension = extname(input).toLowerCase();
  if (!FORMATTABLE_EXTENSIONS.has(extension)) {
    throw new TypeError(
      `smithers format accepts ${[...FORMATTABLE_EXTENSIONS].join(", ")} files: ${input}`,
    );
  }
  const snapshot = readBoundedUtf8File(input, MAX_CLI_SOURCE_BYTES, "source file");
  const result = formatSmithersSource(snapshot.source, {
    fileName: snapshot.fileName,
    ...(indentSize === undefined ? {} : { indentSize }),
  });
  return {
    file: snapshot.fileName,
    ok: result.ok,
    changed: result.changed,
    formatted: result.code,
    diagnostics: result.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      file: snapshot.fileName,
      line: diagnostic.line,
      column: diagnostic.column,
    })),
  };
}

const TEST_PROTOCOL_PREFIX = "__SMITHERS_TEST_PROTOCOL_V1_";
const TEST_OUTPUT_LIMIT = 1024 * 1024;
const TEST_PROTOCOL_RECORD_LIMIT = 100_000;

interface TestProtocol {
  readonly discovered: number;
  readonly passed: number;
  readonly failed: number;
  readonly summary: string;
  readonly tests: readonly {
    readonly name: string;
    readonly ok: boolean;
    readonly error?: string;
  }[];
}

function parseTestProtocol(stdout: string, protocolMarker: string): { readonly output: string; readonly protocol: TestProtocol } {
  const marker = `\n${protocolMarker}`;
  const index = stdout.lastIndexOf(marker);
  if (index < 0) throw new TypeError("test process exited without its result protocol");
  const encoded = stdout.slice(index + marker.length).trim();
  const value: unknown = JSON.parse(encoded);
  if (!isRecord(value) || !Array.isArray(value.tests) ||
    !Number.isSafeInteger(value.discovered) || !Number.isSafeInteger(value.passed) ||
    !Number.isSafeInteger(value.failed) || typeof value.summary !== "string") {
    throw new TypeError("test process returned an invalid result protocol");
  }
  const expectedFields = ["discovered", "failed", "passed", "summary", "tests"];
  if (Object.keys(value).sort(compareText).join("\0") !== expectedFields.join("\0")) {
    throw new TypeError("test process returned an invalid result protocol");
  }
  const discovered = value.discovered as number;
  const passed = value.passed as number;
  const failed = value.failed as number;
  if (discovered < 0 || passed < 0 || failed < 0 || value.tests.length > TEST_PROTOCOL_RECORD_LIMIT ||
    value.tests.length !== passed + failed || discovered < passed || discovered > value.tests.length ||
    value.summary !== `${passed} passed, ${failed} failed`) {
    throw new TypeError("test process returned inconsistent result counts");
  }
  let observedPassed = 0;
  let observedFailed = 0;
  const names = new Set<string>();
  for (const entry of value.tests) {
    if (!isRecord(entry) || typeof entry.name !== "string" || entry.name === "" || typeof entry.ok !== "boolean") {
      throw new TypeError("test process returned an invalid test result");
    }
    const fields = Object.keys(entry).sort(compareText);
    const expected = entry.ok ? ["name", "ok"] : ["error", "name", "ok"];
    if (fields.join("\0") !== expected.join("\0") ||
      (!entry.ok && (typeof entry.error !== "string" || entry.error.length > 65_536)) ||
      names.has(entry.name)) {
      throw new TypeError("test process returned an invalid test result");
    }
    names.add(entry.name);
    if (entry.ok) observedPassed += 1;
    else observedFailed += 1;
  }
  if (observedPassed !== passed || observedFailed !== failed) {
    throw new TypeError("test process result records disagree with their counts");
  }
  return { output: stdout.slice(0, index), protocol: value as unknown as TestProtocol };
}

function createTestRunner(
  modules: readonly { readonly url: string; readonly label: string }[],
  runtimeUrl: string,
  protocolMarker: string,
): string {
  return [
    `import { __vsInspectResult, isResult } from ${JSON.stringify(runtimeUrl)}`,
    `const modules = ${JSON.stringify(modules)}`,
    "let passed = 0",
    "let failed = 0",
    "let discovered = 0",
    "const tests = []",
    "for (const moduleEntry of modules) {",
    "  const { url: moduleUrl, label: moduleLabel } = moduleEntry",
    "  let namespace",
    "  try {",
    "    namespace = await import(moduleUrl)",
    "  } catch (error) {",
    "    failed += 1",
    "    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)",
    "    tests.push({ name: `${moduleLabel}#<module>`, ok: false, error: detail.slice(0, 65536) })",
    "    continue",
    "  }",
    "  for (const name of Object.keys(namespace).sort()) {",
    "    const test = namespace[name]",
    "    if (!/^test(?:$|[A-Z0-9_])/.test(name) || typeof test !== 'function') continue",
    "    discovered += 1",
    "    const label = `${moduleLabel}#${name}`",
    "    try {",
    "      if (test.length !== 0) throw new TypeError('exported Smithers test functions must take zero arguments')",
    "      const value = await test()",
    "      if (isResult(value)) {",
    "        const inspected = __vsInspectResult(value)",
    "        if (!inspected.ok) throw inspected.error",
      "      }",
      "      passed += 1",
    "      tests.push({ name: label, ok: true })",
    "    } catch (error) {",
    "      failed += 1",
    "      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)",
    "      tests.push({ name: label, ok: false, error: detail.slice(0, 65536) })",
    "    }",
    "  }",
    "}",
    "if (discovered === 0) {",
    "  failed += 1",
    "  tests.push({ name: '<discovery>', ok: false, error: 'No exported zero-argument test* functions were found' })",
    "}",
    "const summary = `${passed} passed, ${failed} failed`",
    `console.log("\\n" + ${JSON.stringify(protocolMarker)} + JSON.stringify({ discovered, passed, failed, summary, tests }))`,
    "if (failed > 0) process.exitCode = 1",
    "",
  ].join("\n");
}

/**
 * One probed executable. `doctor` reports whether a component satisfies the
 * project contract, so "not installed", "installed but failing", "installed but
 * hung", and "installed but printed no version" cannot collapse into one value:
 * the first is a missing optional toolchain and the rest are broken
 * installations that a user must be told about by name.
 */
type ExecutableReport =
  | { readonly available: true; readonly version: string }
  | {
    readonly available: false;
    readonly reason: "absent" | "failed" | "timeout" | "no-version-output";
    readonly detail?: string;
  };

function shorten(text: string): string {
  const first = text.trim().split("\n")[0]?.trim() ?? "";
  return first.length > 200 ? `${first.slice(0, 200)}…` : first;
}

function probeExecutable(command: string, args: readonly string[] = ["--version"]): ExecutableReport {
  const child = spawnSync(command, args, { encoding: "utf8", timeout: 2_000 });
  const error = child.error as NodeJS.ErrnoException | undefined;
  if (error) {
    if (error.code === "ENOENT") return { available: false, reason: "absent" };
    if (error.code === "ETIMEDOUT") return { available: false, reason: "timeout" };
    return { available: false, reason: "failed", detail: shorten(error.message) };
  }
  // A timeout kill arrives as a signal with no `error` on some platforms.
  if (child.signal) return { available: false, reason: "timeout", detail: child.signal };
  if (child.status !== 0) {
    return {
      available: false,
      reason: "failed",
      detail: shorten(`exit ${String(child.status)}: ${child.stderr || child.stdout || ""}`),
    };
  }
  // stderr is diagnostic output, never a version banner: a tool that exits 0
  // while printing only to stderr has not reported a version.
  const version = shorten(child.stdout ?? "");
  return version === "" ? { available: false, reason: "no-version-output" } : { available: true, version };
}

const cli = Cli.create("smithers", { version, description: "Smithers checked prototype toolchain" })
  .command("compile", {
    args: files,
    options: backendCompileOptions,
    alias: { project: "p", watch: "w" },
    description: "Compile .sm with the checked frontend, or delegate TS/JS to TypeScript",
    hint: "Use smithersc when exact raw tsc argument compatibility is required.",
    async run(context) {
      const inputFiles = context.args.files;
      const { backend, ...options } = context.options;
      if (backend === "js" && !inputFiles?.some(isSmithersFile)) {
        return finishCompiler(runTypeScriptCompiler(compilerArgs(inputFiles, options)));
      }
      if (backend === "go" && !inputFiles?.some(isSmithersFile)) {
        return context.error({
          code: "SMITHERS_GO_INPUT",
          exitCode: 2,
          message: "--backend go currently accepts .sm inputs only; use --backend js for TypeScript or JavaScript inputs",
        });
      }
      const smithersInputs = inputFiles!;
      if (containsMixedInputs(smithersInputs)) {
        return context.error({ code: "MIXED_FRONTENDS", exitCode: 2, message: "compile .sm and TypeScript inputs in separate invocations" });
      }
      const unsupported = unsupportedSmithersOptions(options, new Set(["outDir", "rootDir", "noEmit", "declaration", "sourceMap"]));
      if (unsupported.length > 0) {
        return context.error({
          code: "UNSUPPORTED_SMITHERS_OPTION",
          exitCode: 2,
          message: `.sm compile does not support ${unsupported.join(", ")}; supported options are --outDir, --rootDir, --declaration, --sourceMap, and --noEmit`,
        });
      }
      const collision = duplicateSmithersOutput(smithersInputs, options.outDir);
      if (collision) {
        return context.error({
          code: "DUPLICATE_SMITHERS_OUTPUT",
          exitCode: 2,
          message: `${collision.inputs.join(" and ")} both emit ${collision.output}`,
        });
      }
      if (options.noEmit && (options.declaration || options.sourceMap)) {
        return context.error({
          code: "CONFLICTING_SMITHERS_OPTIONS",
          exitCode: 2,
          message: ".sm compile cannot combine --noEmit with --declaration or --sourceMap",
        });
      }
      try {
        const compile = backend === "go" ? compileGoSmithersFiles : compileSmithersFiles;
        return reportSmithersResults(await compile(smithersInputs, {
          outDir: options.outDir,
          rootDir: options.rootDir,
          emit: !options.noEmit,
          declaration: options.declaration,
          sourceMap: options.sourceMap,
        }));
      } catch (error) {
        return backendFailure(context, error);
      }
    },
  })
  .command("check", {
    args: files,
    options: backendCompileOptions.omit({ noEmit: true }),
    alias: { project: "p", watch: "w" },
    description: "Check .sm rows and emitted TS, or type-check TS/JS without emitting",
    async run(context) {
      const inputFiles = context.args.files;
      const { backend, ...options } = context.options;
      if (backend === "js" && !inputFiles?.some(isSmithersFile)) {
        return finishCompiler(runTypeScriptCompiler(["--noEmit", ...compilerArgs(inputFiles, options)]));
      }
      if (backend === "go" && !inputFiles?.some(isSmithersFile)) {
        return context.error({
          code: "SMITHERS_GO_INPUT",
          exitCode: 2,
          message: "--backend go currently accepts .sm inputs only; use --backend js for TypeScript or JavaScript inputs",
        });
      }
      const smithersInputs = inputFiles!;
      if (containsMixedInputs(smithersInputs)) {
        return context.error({ code: "MIXED_FRONTENDS", exitCode: 2, message: "check .sm and TypeScript inputs in separate invocations" });
      }
      const unsupported = unsupportedSmithersOptions(options, new Set<keyof CompileOptions>(["rootDir"]));
      if (unsupported.length > 0) {
        return context.error({
          code: "UNSUPPORTED_SMITHERS_OPTION",
          exitCode: 2,
          message: `.sm check does not support ${unsupported.join(", ")}`,
        });
      }
      try {
        const compile = backend === "go" ? compileGoSmithersFiles : compileSmithersFiles;
        return reportSmithersResults(await compile(smithersInputs, {
          rootDir: options.rootDir,
          emit: false,
        }));
      } catch (error) {
        return backendFailure(context, error);
      }
    },
  })
  .command("run", {
    args: files,
    options: z.object({ backend: backendOption }),
    description: "Compile and run one .sm file under Node (prototype subset)",
    async run(context) {
      const [input, ...programArguments] = requireInputs(context.args.files);
      if (!isSmithersFile(input)) {
        return context.error({ code: "INVALID_INPUT", exitCode: 2, message: "smithers run requires a .sm input" });
      }
      let temporary: string | undefined;
      try {
        const inputPath = realpathSync(resolve(input));
        temporary = mkdtempSync(join(dirname(inputPath), ".smithers-run-"));
        writeFileSync(join(temporary, "package.json"), "{\"type\":\"module\"}\n");
        const runtime = fileURLToPath(new URL("../poc/dist/runtime/index.js", import.meta.url));
        // The derived-schema seam deliberately keeps its package specifier here:
        // a resolvable local path would make the frontend read `__vsSchema` as an
        // untrusted foreign module, and `smthrs/schema-runtime` resolves from
        // the emitted module for every installed consumer.
        const results = context.options.backend === "go"
          ? compileGoSmithersFiles([input], { outDir: temporary })
          : await compileSmithersFiles([input], { outDir: temporary, runtimeImport: runtime });
        const report = reportSmithersResults(results);
        const result = results.find((candidate) => candidate.input === inputPath);
        if (!report.ok || !result?.output) return report;
        if (context.formatExplicit) {
          const child = spawnSync(process.execPath, [result.output, ...programArguments], {
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
          });
          if (child.error) throw child.error;
          if (child.status !== 0) process.exitCode = child.status ?? 1;
          return {
            ok: child.status === 0,
            input: resolve(input),
            exitCode: child.status ?? 1,
            output: child.stdout,
            errorOutput: child.stderr,
          };
        }
        const child = spawnSync(process.execPath, [result.output, ...programArguments], { stdio: "inherit" });
        if (child.error) throw child.error;
        if (child.status !== 0) process.exitCode = child.status ?? 1;
        return { ok: child.status === 0, input: resolve(input), exitCode: child.status ?? 1 };
      } catch (error) {
        return backendFailure(context, error);
      } finally {
        if (temporary) rmSync(temporary, { recursive: true, force: true });
      }
    },
  })
  .command("inspect", {
    args: files,
    description: "Print checked failure and Context requirement rows",
    async run(context) {
      const inputs = requireInputs(context.args.files);
      const nonSmithers = inputs.filter((file) => !isSmithersFile(file));
      if (nonSmithers.length > 0) {
        return context.error({
          code: "INVALID_INPUT",
          exitCode: 2,
          message: `smithers inspect currently accepts only .sm files: ${nonSmithers.join(", ")}`,
        });
      }
      let inspected: Array<{ file: string; language: ReturnType<typeof analyzeSource> }>;
      try {
        const project = loadSmithersProject(inputs);
        const assetContext = sourceAssetCompilerForProject(project.rootDir);
        const sourceAssets = await compileSourceAssetModules({
          compiler: assetContext.compiler,
          sources: project.sources,
        });
        if (!sourceAssets.ok) {
          process.exitCode = 1;
          return {
            ok: false,
            code: "SMITHERS_ASSET_IMPORT",
            files: [],
            assets: {
              cacheIdentity: assetContext.cacheIdentity,
              modules: [],
              diagnostics: sourceAssets.diagnostics,
            },
          };
        }
        const language = analyzeProject(project.sources, {
          rootDir: project.rootDir,
          additionalRuntimeSources: sourceAssets.modules,
        });
        inspected = project.sources.map((source) => {
          const file = resolve(project.rootDir, source.fileName);
          return {
            file,
            language: language.files[source.fileName],
          };
        });
      } catch (error) {
        return context.error({
          code: "SMITHERS_PROJECT_ERROR",
          exitCode: 2,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      const ok = inspected.every((item) =>
        !item.language.diagnostics.some((diagnostic) => diagnostic.severity === "error"));
      if (!ok) process.exitCode = 1;
      return { ok, files: inspected };
    },
  })
  .command("plan", {
    args: files,
    options: z.object({
      bindings: z.string().optional().describe("JSON file mapping imported Actions to pinned descriptors"),
      outFile: z.string().optional().describe("Write the canonical Plan artifact to this file"),
    }),
    description: "Statically lower one durable(...) declaration without executing authored code",
    run(context) {
      try {
        const input = requireOneInput(context.args.files, "smithers plan");
        if (!isSmithersFile(input)) throw new TypeError("smithers plan requires a .sm input");
        if (!context.options.bindings) throw new TypeError("smithers plan requires --bindings <actions.json>");
        const source = readBoundedUtf8File(input, MAX_CLI_SOURCE_BYTES, "durable source file");
        const absolute = source.fileName;
        if (!isSmithersFile(absolute)) throw new TypeError("smithers plan requires a canonical .sm input");
        const config = readDurablePlanConfig(context.options.bindings);
        const result = compileDurableSource(source.source, {
          fileName: basename(absolute),
          flowId: config.flowId,
          flowVersion: config.flowVersion,
          actions: config.actions,
        });
        if (!result.ok) {
          process.exitCode = 1;
          return { ok: false, file: absolute, diagnostics: result.diagnostics };
        }
        let artifact: string | undefined;
        if (context.options.outFile) {
          const requestedArtifact = resolve(context.options.outFile);
          if (existsSync(requestedArtifact) && lstatSync(requestedArtifact).isSymbolicLink()) {
            throw new TypeError("durable Plan output cannot be a symbolic link");
          }
          artifact = canonicalFuturePath(requestedArtifact);
          if (existsSync(artifact) && !statSync(artifact).isFile()) {
            throw new TypeError("durable Plan output must be a regular file when it already exists");
          }
          if (pathsReferToSameFile(artifact, absolute) || pathsReferToSameFile(artifact, config.fileName)) {
            throw new TypeError("durable Plan output cannot overwrite its source or bindings file");
          }
          const canonical = new TextDecoder().decode(result.artifact);
          commitProjectFiles(dirname(artifact), [{ fileName: artifact, code: canonical }]);
        }
        return {
          ok: true,
          file: absolute,
          artifact,
          digest: result.plan.digest,
          plan: result.plan,
        };
      } catch (error) {
        return context.error({
          code: "SMITHERS_PLAN_ERROR",
          exitCode: 2,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  })
  .command("build", {
    args: z.object({ projects: z.array(z.string()).optional().describe("TypeScript projects to build") }),
    options: z.object({
      clean: z.boolean().optional().describe("Delete build outputs"),
      dry: z.boolean().optional().describe("Show what would be built or deleted"),
      force: z.boolean().optional().describe("Build all projects"),
      verbose: z.boolean().optional().describe("Explain build decisions"),
      watch: z.boolean().optional().describe("Watch projects"),
    }),
    description: "Build TypeScript project references (raw TypeScript backend)",
    run(context) {
      const args = ["--build"];
      for (const [name, enabled] of Object.entries(context.options)) if (enabled) args.push(`--${name}`);
      if (context.args.projects) args.push(...context.args.projects);
      return finishCompiler(runTypeScriptCompiler(args));
    },
  })
  .command("init", {
    description: "Create a TypeScript-compatible tsconfig.json",
    run() { return finishCompiler(runTypeScriptCompiler(["--init"])); },
  })
  .command("format", {
    args: files,
    options: z.object({
      check: z.boolean().optional().describe("List unformatted files and exit nonzero without writing"),
      stdout: z.boolean().optional().describe("Print the formatted source instead of writing files"),
      indentSize: z.number().int().min(1).max(8).optional().describe("Spaces per indentation level (default 2)"),
    }),
    description: "Format Smithers and TypeScript sources deterministically",
    hint: "Formatting is whitespace-only and idempotent; a file that cannot be formatted soundly is reported, never rewritten.",
    examples: [
      { args: { files: ["src/app.sm"] }, description: "Format one module in place" },
      { args: { files: ["src/app.sm"] }, options: { check: true }, description: "Fail if the module is unformatted" },
      { args: { files: ["src/app.sm"] }, options: { stdout: true }, description: "Print the formatted module" },
    ],
    run(context) {
      const inputs = context.args.files;
      if (!inputs || inputs.length === 0) {
        return context.error({ code: "INVALID_INPUT", exitCode: 2, message: "smithers format requires at least one input file" });
      }
      if (context.options.check && context.options.stdout) {
        return context.error({ code: "INVALID_INPUT", exitCode: 2, message: "smithers format --check and --stdout are mutually exclusive" });
      }
      let results: FormatFileResult[];
      try {
        results = inputs.map((input) => formatOneFile(input, context.options.indentSize));
      } catch (error) {
        return context.error({
          code: "SMITHERS_FORMAT_ERROR",
          exitCode: 2,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      const failures = results.filter((result) => !result.ok);
      const unformatted = results.filter((result) => result.ok && result.changed);

      if (context.options.check) {
        const ok = failures.length === 0 && unformatted.length === 0;
        if (!ok) process.exitCode = 1;
        return {
          ok,
          mode: "check" as const,
          unformatted: unformatted.map((result) => result.file),
          checked: results.length,
          files: results.map(({ formatted: _formatted, ...rest }) => rest),
        };
      }

      if (context.options.stdout) {
        const ok = failures.length === 0;
        if (!ok) process.exitCode = 1;
        // A structured format is the agent-facing contract, so the source is
        // carried inside the envelope. Only the unstructured human/pipe path
        // writes raw text, and then nothing else may reach stdout.
        if (ok && !context.formatExplicit) {
          writeFileSync(1, results.map((result) => result.formatted ?? "").join(""));
          process.exit(0);
        }
        return { ok, mode: "stdout" as const, files: results };
      }

      const written: string[] = [];
      try {
        for (const result of results) {
          if (!result.ok || !result.changed || result.formatted === undefined) continue;
          writeFormattedFile(result.file, result.formatted);
          written.push(result.file);
        }
      } catch (error) {
        return context.error({
          code: "SMITHERS_FORMAT_WRITE_ERROR",
          exitCode: 2,
          message: error instanceof Error ? error.message : String(error),
        });
      }
      const ok = failures.length === 0;
      if (!ok) process.exitCode = 1;
      return {
        ok,
        mode: "write" as const,
        formatted: written,
        unchanged: results.filter((result) => result.ok && !result.changed).length,
        files: results.map(({ formatted: _formatted, ...rest }) => rest),
      };
    },
  })
  .command("test", {
    args: files,
    options: z.object({
      timeoutMs: z.number().int().min(100).max(300_000).default(30_000)
        .describe("Maximum time for the isolated test process"),
    }),
    description: "Compile and run exported zero-argument test* functions",
    async run(context) {
      const inputs = context.args.files;
      if (!inputs || inputs.length === 0) {
        return context.error({ code: "INVALID_INPUT", exitCode: 2, message: "smithers test requires at least one .sm input" });
      }
      const nonSmithers = inputs.filter((file) => !isSmithersFile(file));
      if (nonSmithers.length > 0) {
        return context.error({
          code: "INVALID_INPUT",
          exitCode: 2,
          message: `smithers test currently accepts only .sm files: ${nonSmithers.join(", ")}`,
        });
      }
      let temporary: string | undefined;
      try {
        const canonicalInputs = inputs.map((input) => realpathSync(resolve(input)));
        for (let index = 0; index < canonicalInputs.length; index += 1) {
          const duplicate = canonicalInputs.slice(0, index)
            .find((candidate) => pathsReferToSameFile(candidate, canonicalInputs[index]!));
          if (duplicate) {
            throw new TypeError(
              `smithers test received the same canonical module more than once: ${duplicate} and ${canonicalInputs[index]}`,
            );
          }
        }
        temporary = mkdtempSync(join(commonSourceRoot(canonicalInputs), ".smithers-test-"));
        writeFileSync(join(temporary, "package.json"), "{\"type\":\"module\"}\n");
        const runtime = fileURLToPath(new URL("../poc/dist/runtime/index.js", import.meta.url));
        const results = await compileSmithersFiles(inputs, {
          outDir: temporary,
          runtimeImport: runtime,
          sourceBudget: {
            maximumFileBytes: MAX_CLI_SOURCE_BYTES,
            maximumTotalBytes: MAX_TEST_PROJECT_BYTES,
            maximumFiles: MAX_TEST_PROJECT_FILES,
          },
        });
        const report = reportSmithersResults(results);
        if (!report.ok) return report;
        const entries = canonicalInputs.map((absolute) => {
          const output = results.find((result) => result.input === absolute)?.output;
          if (!output) throw new TypeError(`test entry emitted no module: ${absolute}`);
          const relativeLabel = relative(process.cwd(), absolute).split(sep).join("/");
          return {
            url: pathToFileURL(output).href,
            label: relativeLabel === "" ? basename(absolute) : relativeLabel,
          };
        });
        const protocolMarker = `${TEST_PROTOCOL_PREFIX}${randomBytes(16).toString("hex")}__`;
        const runner = join(temporary, "__smithers_test_runner__.mjs");
        writeFileSync(runner, createTestRunner(entries, pathToFileURL(runtime).href, protocolMarker), { flag: "wx" });
        const child = spawnSync(process.execPath, [runner], {
          encoding: "utf8",
          timeout: context.options.timeoutMs,
          killSignal: "SIGKILL",
          maxBuffer: TEST_OUTPUT_LIMIT,
        });
        if (child.error) {
          if ((child.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
            process.exitCode = 1;
            return {
              ok: false,
              files: inputs.map((input) => resolve(input)),
              exitCode: 1,
              summary: `test process exceeded ${context.options.timeoutMs}ms`,
              output: child.stdout,
              errorOutput: child.stderr,
              tests: [],
            };
          }
          throw child.error;
        }
        const { output, protocol } = parseTestProtocol(child.stdout, protocolMarker);
        const exitCode = child.status ?? 1;
        if ((exitCode === 0) !== (protocol.failed === 0)) {
          throw new TypeError("test process exit status disagrees with its result protocol");
        }
        if (exitCode !== 0) process.exitCode = exitCode;
        return {
          ok: exitCode === 0,
          files: inputs.map((input) => resolve(input)),
          exitCode,
          ...protocol,
          output,
          errorOutput: child.stderr,
        };
      } catch (error) {
        return context.error({
          code: "SMITHERS_TEST_ERROR",
          exitCode: 2,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (temporary) rmSync(temporary, { recursive: true, force: true });
      }
    },
  })
  .command("lsp", {
    description: "Start the Smithers language server on stdio (LSP over JSON-RPC 2.0)",
    hint: "Bounded on purpose: one workspace folder, full-document sync, and diagnostics, hover, definition, and formatting only.",
    async run() {
      // The language server owns stdout for the whole session, so no structured
      // envelope may be printed after it: this command terminates the process
      // itself once the client's `exit` notification arrives, after flushing.
      const code = await startSmithersLanguageServer().closed;
      await new Promise<void>((settle) => { process.stdout.write("", () => { settle(); }); });
      process.exit(code);
    },
  })
  .command("doctor", {
    description: "Inspect installed backends and implemented prototype surfaces",
    run() {
      const nativeCompiler = resolveTypeScriptCompiler();
      const nativeTypeScript = probeExecutable(process.execPath, [nativeCompiler, "--version"]);
      const packagedRuntime = existsSync(fileURLToPath(new URL("../poc/dist/runtime/index.js", import.meta.url)));
      // `ok` is derived from the checks this command actually performed. It was
      // previously the literal `true`, which certified an environment doctor had
      // never assessed. The required components are the ones no command can work
      // without; the foreign toolchains below are optional and are reported
      // without gating the verdict, so a machine with no Zig or Rust is healthy.
      const required = {
        nativeTypeScript: nativeTypeScript.available,
        packagedRuntime,
      };
      const failures = Object.entries(required)
        .filter(([, satisfied]) => !satisfied)
        .map(([name]) => name);
      const ok = failures.length === 0;
      if (!ok) process.exitCode = 1;
      return {
        ok,
        // Named so a caller can see which required check failed rather than
        // inferring it. Empty on a healthy environment.
        unsatisfied: failures,
        smithers: version,
        node: process.version,
        nativeCompiler,
        nativeTypeScript,
        javascriptApi: ts.version,
        tools: {
          deno: probeExecutable("deno"),
          zig: probeExecutable("zig", ["version"]),
          rustc: probeExecutable("rustc", ["--version"]),
          go: probeExecutable("go", ["version"]),
        },
        surfaces: {
          smithersCompile: "cross-module prototype with declarations and composed source maps",
          smithersCheck: "cross-module checked-row prototype",
          smithersRun: "Node prototype subset",
          inspectRowsAndTargets: "prototype",
          comptimeAndAssets: "bounded comptime functions, target selection, tracked text embed, and static assets; loaders remain programmatic",
          codingAgent: "programmatic API",
          durablePlanCompiler: "static smithers plan command and programmatic API",
          durableExecutor: "Bun-only subpath: smthrs/durable/bun",
          languageServer: "stdio LSP: diagnostics, hover rows, definition, formatting; one workspace folder, full-document sync",
          formatter: "idempotent whitespace-only .sm/TypeScript formatter with Smithers construct masking",
          testRunner: "exported zero-argument test* prototype",
        },
        packagedRuntime,
      };
    },
  });

await cli.serve();
