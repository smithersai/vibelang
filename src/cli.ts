import {
  MAX_CLI_SOURCE_BYTES,
  MAX_TEST_PROJECT_BYTES,
  MAX_TEST_PROJECT_FILES,
  DEFAULT_VIBELANG_PROJECT_BUDGET,
  rowsNotComputed,
  compareText,
  isVibeLangFile,
  isRecord,
  readBoundedUtf8File,
  canonicalFuturePath,
  commonSourceRoot,
  loadVibeLangProject,
  sourceAssetCompilerForProject,
  compileVibeLangFiles,
  authoredLineColumn,
  formatGoDiagnostic,
  commitProjectFiles,
  type CliDiagnostic,
  type VibeLangFileResult,
} from "./project-build.js";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Cli, z } from "incur";
import { getNativeCompiler } from "../poc/dist/compiler/native.js";
import type { NativeProjectConfigResult } from "../poc/dist/compiler/protocol.js";

import {
  analyzeProject,
  analyzeSource,
  formatVibeLangSource,
  startVibeLangLanguageServer,
  validateVibeLangTsconfig,
} from "../poc/dist/language/index.js";
import { compileSourceAssetModules } from "../poc/dist/build/index.js";
import {
  compileEffectManifest,
  type DurableSourceActionBinding,
} from "../poc/dist/durable/source-compiler.js";
import { canonicalJson } from "../poc/dist/durable/value.js";
import { captureTypeScriptCompiler, resolveTypeScriptCompiler, runTypeScriptCompiler } from "./compiler-process.js";
import {
  GoBackendFailure,
  asGoBackendFailure,
  invokeGoBackend,
  resolveGoDiagnosticFile,
} from "./go-backend.js";
import { buildRelativeRuntimeGraph } from "./relative-runtime-graph.js";

const version = "0.0.1";

const files = z.object({
  files: z.array(z.string()).optional().describe(".vibe, TypeScript, or JavaScript source files"),
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
  .describe("Go-engine delivery profile: js uses the SDK pipeline; go uses direct native emission");
const backendCompileOptions = compileOptions.extend({ backend: backendOption });

type CompileOptions = z.infer<typeof compileOptions>;


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





function unsupportedVibeLangOptions(
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


function isPlainAsciiIdentifier(value: string): boolean {
  if (!/^[$A-Z_a-z][$0-9A-Z_a-z]*$/.test(value)) return false;
  const token = getNativeCompiler().tokenAt({ text: value, offset: 0 }).token;
  return token?.kind === "Identifier" && token.start === 0 && token.end === value.length;
}


function assertNoDuplicateJsonKeys(source: string, fileName: string): void {
  const json = getNativeCompiler().inspect([{ path: basename(fileName), text: source, scriptKind: "json" }]).files[0]!;
  const duplicate = json.jsonDuplicateKeys![0];
  if (!duplicate) return;
  // The caller has already required strict JSON. Decode only the native
  // parser's exact key token, preserving escaped surrogate/code-point identity.
  const key: unknown = JSON.parse(source.slice(duplicate.start, duplicate.start + duplicate.length));
  const position = authoredLineColumn(source, duplicate.start);
  throw new TypeError(`durable bindings contain duplicate key ${JSON.stringify(key)} at ${position.line}:${position.column}`);
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
    if (binding.moduleSpecifier === "vibelang:flows") {
      throw new TypeError(`durable action binding ${index} cannot replace vibelang:flows`);
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

/** A successful inspection may publish bytes, but never clobber any input that
 * contributed to the inspected identity. Both profiles share these guards. */
function writeDurableInspection(
  outFile: string | undefined,
  bytes: string,
  protectedFiles: readonly string[],
  kind: "Plan" | "Manifest",
): string | undefined {
  if (outFile === undefined) return undefined;
  const requested = resolve(outFile);
  if (lstatSync(requested, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new TypeError(`durable ${kind} output cannot be a symbolic link`);
  }
  const artifact = canonicalFuturePath(requested);
  if (existsSync(artifact) && !statSync(artifact).isFile()) {
    throw new TypeError(`durable ${kind} output must be a regular file when it already exists`);
  }
  if (protectedFiles.some(file => pathsReferToSameFile(artifact, file))) {
    throw new TypeError(kind === "Manifest"
      ? "durable Manifest output cannot overwrite its source or bindings file"
      : "durable Plan output cannot overwrite a source, dependency, input, or providers file");
  }
  commitProjectFiles(dirname(artifact), [{ fileName: artifact, code: `${bytes}\n` }]);
  return artifact;
}

function containsMixedInputs(inputFiles: readonly string[]): boolean {
  return inputFiles.some(isVibeLangFile) && inputFiles.some((file) => !isVibeLangFile(file));
}


function outputPath(input: string, outDir: string | undefined, extension: ".mjs" | ".ts"): string {
  const stem = basename(input, extname(input));
  return resolve(outDir ?? dirname(input), `${stem}${extension}`);
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

function duplicateVibeLangOutput(
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


function decodeGoArtifact(path: string, content: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(content, "base64"));
  } catch (error) {
    throw new GoBackendFailure(
      "VIBELANG_GO_PROTOCOL",
      `The Go compiler returned a non-UTF-8 artifact ${path}: ${error instanceof Error ? error.message : String(error)}. ` +
      "Remedy: run `npm run build` to rebuild the CLI and Go request producer together.",
    );
  }
}

function compileGoVibeLangFiles(
  inputNames: readonly string[],
  options: {
    readonly outDir?: string;
    readonly rootDir?: string;
    readonly emit?: boolean;
    readonly declaration?: boolean;
    readonly sourceMap?: boolean;
    /** The project's tsconfig.json, forwarded so the fork can gate on it too. */
    readonly configFile?: { readonly path: string; readonly text: string };
  },
): readonly VibeLangFileResult[] {
  const project = loadVibeLangProject(inputNames, options.rootDir);
  const outDir = canonicalFuturePath(resolve(options.outDir ?? project.rootDir));
  /**
   * A VibeLang project is not a list of `.vibe` files.
   *
   * `loadVibeLangProject` walks `.vibe` imports only, so the request used to
   * consist entirely of `kind: "vibelang"` sources and the `"typescript"` kind
   * the protocol has always declared was never produced by anything. Every
   * `.vibe` module that imports a foreign `./x.ts` therefore failed to resolve it
   * and was refused with VIBE1510 — the right code for the wrong reason,
   * since "the module could not be resolved" is not "the module is untrusted".
   *
   * The dependency set was already being computed: `buildRelativeRuntimeGraph`
   * is the reference backend's own walk, and it resolves, bounds, and refuses
   * these edges (a symlink alias, a hard-link alias, an escape from the project
   * root, an ambiguous specifier, a budget overrun). Reusing it rather than
   * writing a second walk is what makes the two backends agree on which files
   * are in the project and refuse the same shapes for the same reasons.
   *
   * What is taken from it is the dependency set, plus the one verdict that
   * belongs to project loading rather than to a backend — see the trust check
   * immediately below. Everything else the fork decides for itself, from the
   * same bytes.
   */
  const dependencies = buildRelativeRuntimeGraph({
    rootDir: project.rootDir,
    outDir,
    vibelangSources: project.runtimeSeeds,
    vibelangOutputs: project.runtimeSeeds.map((source) => ({
      sourceFileName: source.fileName,
      // The Go emit renames `x.vibe.js` to `x.js`, so those are the paths whose
      // collisions this walk should be checking.
      outputFileName: resolve(outDir, relative(project.rootDir, source.fileName).replace(/\.vibe$/, ".js")),
    })),
    // The fork runs its own asset pass over raw bytes, so there are no
    // pre-compiled asset modules to hand in and the asset files themselves are
    // what it needs staged.
    assetSpecifiers: "stage",
    budget: DEFAULT_VIBELANG_PROJECT_BUDGET,
  });
  /**
   * The foreign initialization-trust verdict is a project-loading verdict, and
   * it stops both backends at the same place for the same reason.
   *
   * The walk computes the *transitive* static-initialization closure: a trusted
   * facade that re-exports an untrusted module is refused at the untrusted
   * module, because importing the facade evaluates it. That closure is a
   * property of the project, not of a backend, and the reference path already
   * stops here rather than compiling (`compileVibeLangFiles`, the identical
   * early return).
   *
   * Mirroring it is what keeps staging from being a fail-open. Before the
   * sources were staged, an untrusted foreign graph was refused on this backend
   * only because nothing resolved — the right code for the wrong reason, and
   * accidentally safe. Staging removes that accident: the fork's own edge check
   * covers the edges an authored `.vibe` spells, so a *directly* untrusted import
   * is still refused, but nothing on that side walks foreign-to-foreign edges,
   * so a transitively untrusted graph would have started compiling clean. This
   * return keeps the answer the reference's, at the reference's position, so
   * the two backends agree on the same bytes instead of one of them relaxing.
   */
  if (dependencies.diagnostics.length > 0) {
    return project.sources.map((source, index): VibeLangFileResult => ({
      input: resolve(project.rootDir, source.fileName),
      diagnostics: index === 0
        ? dependencies.diagnostics.map((diagnostic): CliDiagnostic => ({
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
  // `dependencies.files` holds only foreign modules here: the generated asset
  // modules that otherwise share that list are produced from
  // `generatedRuntimeSources`, which this request never supplies.
  const stagedSources = [
    ...[...dependencies.files, ...dependencies.checkerDependencies].map((file) => ({
      path: file.displayName,
      kind: "typescript" as const,
      text: file.source,
    })),
    ...dependencies.stagedAssets.map((file) => ({
      path: file.displayName,
      kind: "asset" as const,
      text: file.source,
    })),
  ];
  const byLogicalName = new Map([
    ...project.sources.map((source) => [source.fileName, source] as const),
    ...stagedSources.map((file) => [file.path, { fileName: file.path, source: file.text }] as const),
  ]);
  const compiled = invokeGoBackend({
    rootNames: project.sources.map((source) => source.fileName),
    files: [
      ...project.sources.map((source) => ({
        path: source.fileName,
        kind: "vibelang" as const,
        text: source.source,
      })),
      ...stagedSources,
    ],
    options: {
      noEmit: options.emit === false,
      noEmitOnError: true,
      declaration: options.declaration === true,
      sourceMap: options.sourceMap === true,
      inlineSources: options.sourceMap === true,
    },
    lowering: "internal",
    ...(options.configFile ? { configFile: options.configFile } : {}),
  });

  const diagnostics = new Map(project.sources.map((source) => [source.fileName, [] as CliDiagnostic[]]));
  const requestSources = new Set(byLogicalName.keys());
  for (const diagnostic of compiled.diagnostics) {
    // A name the request never sent fails closed inside `resolveGoDiagnosticFile`
    // rather than landing on whichever source happens to be first. A diagnostic
    // that names no file at all is project-level: it goes in the first bucket so
    // it is still reported and still gates, and `formatGoDiagnostic` leaves its
    // `file` unset, so it never claims to come from that file's source.
    //
    // A diagnostic against a staged foreign or asset source is neither: the
    // request did send that file, and `formatGoDiagnostic` names it and locates
    // it in its own text, but the report is keyed by `.vibe` input and a foreign
    // file is not one. It joins the first bucket for the same reason a
    // project-level diagnostic does — so that it is still reported and still
    // gates. Dropping it would let a real error inside a staged `.ts` vanish
    // and the compile read clean, which is exactly what an unbucketed
    // `diagnostics.get(...)` used to do the moment anything but `.vibe` was sent.
    const logicalName = resolveGoDiagnosticFile(diagnostic.file, requestSources);
    const formatted = formatGoDiagnostic(project, byLogicalName, diagnostic);
    const target = logicalName !== undefined && diagnostics.has(logicalName)
      ? diagnostics.get(logicalName)
      : diagnostics.values().next().value;
    target?.push(formatted);
  }
  const hasError = [...diagnostics.values()].some((items) =>
    items.some((diagnostic) => diagnostic.severity === "error"));
  if (options.emit !== false && compiled.emitSkipped && !hasError) {
    diagnostics.values().next().value?.push({
      code: "VIBELANG_GO_EMIT_SKIPPED",
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

  return project.sources.map((source): VibeLangFileResult => {
    const runtimeName = source.fileName.replace(/\.vibe$/, ".js");
    const declarationName = source.fileName.replace(/\.vibe$/, ".d.vibe.ts");
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
  const native = asGoBackendFailure(error);
  if (native) {
    return context.error({ code: native.code, exitCode: 2, message: native.message, retryable: false });
  }
  return context.error({
    code: "VIBELANG_PROJECT_ERROR",
    exitCode: 2,
    message: error instanceof Error ? error.message : String(error),
  });
}


/**
 * Read and validate the project's `tsconfig.json`, as compatibility.mdx
 * §Configuration requires and as nothing did before.
 *
 * `--project`/`-p` has been declared as "Path to tsconfig.json or its directory"
 * since the flag existed, and no VibeLang-owned code ever dereferenced it: on a
 * TypeScript input it was re-serialized straight into a spawned `tsc`, and on a
 * `.vibe` input it was refused as an unsupported option, so the file it names was
 * never opened by this compiler on either path. §Mandatory and §Forbidden were
 * therefore unrepresented rather than merely unchecked.
 *
 * The findings carry VIBE6001/6002/6003 and a real position, because
 * §Forbidden's obligation is that a deprecated option "MUST be rejected rather
 * than ignored" and a rejection with no span cannot tell the author which line
 * to delete. Both backends run the same table; see
 * poc/src/language/compiler-options.ts.
 */
function readVibeLangProjectConfig(project: string): {
  readonly fileName: string;
  readonly text: string;
  readonly diagnostics: readonly CliDiagnostic[];
} | { readonly failure: CliDiagnostic } {
  const requested = resolve(project);
  const fileName = existsSync(requested) && statSync(requested).isDirectory()
    ? join(requested, "tsconfig.json")
    : requested;
  if (!existsSync(fileName)) {
    return {
      failure: {
        code: "VIBE6003",
        severity: "error",
        message: `no tsconfig.json at ${fileName}`,
        file: fileName,
      },
    };
  }
  const text = readFileSync(fileName, "utf8");
  return {
    fileName,
    text,
    diagnostics: validateVibeLangTsconfig(fileName, text).map((diagnostic) => ({
      code: diagnostic.code,
      severity: "error" as const,
      message: diagnostic.message,
      file: diagnostic.fileName,
      line: diagnostic.line,
      column: diagnostic.column,
    })),
  };
}

interface VibeLangProjectInputs {
  readonly fileName: string;
  readonly text: string;
  /** Effective-configuration findings (TS and VIBE600x), extends included. */
  readonly diagnostics: readonly CliDiagnostic[];
  /** Absolute `.vibe` roots the configuration names or matches. */
  readonly files: readonly string[];
  /** Absolute TypeScript/JavaScript roots that are not reached from a `.vibe` root. */
  readonly typeScriptFiles: readonly string[];
  readonly configDirectory: string;
  /**
   * The configuration text the frontends may validate again, present only
   * when the chain is a single file: a child of an `extends` chain is not the
   * effective configuration, and text-only validation would refuse it.
   */
  readonly configFile?: { readonly path: string; readonly text: string };
  readonly rootDir?: string;
  readonly outDir?: string;
  readonly declaration: boolean;
  readonly sourceMap: boolean;
  readonly noEmit: boolean;
}

/**
 * Project mode: `vibe check -p tsconfig.json`, `vibe compile -p tsconfig.json`.
 *
 * The pinned compiler expands a configuration only for the extensions it
 * owns, so a bare `-p` used to type-check the project's TypeScript files and
 * never open a `.vibe` file: a project whose only defect was a dropped Result
 * passed with exit 0 and no output, and a project of nothing but `.vibe`
 * files was refused as having no inputs. The native `discoverProject`
 * operation now expands the same `files`/`include`/`exclude` the
 * configuration declares, JSONC and `extends` included, for every root the
 * project has; the `.vibe` roots go to the checked frontend and the
 * TypeScript roots keep their own compiler. The language's mandatory-option
 * diagnostics (VIBE600x) gate only a project that has `.vibe` roots:
 * compatibility.mdx scopes the mandatory set to `.vibe`, and an ordinary
 * TypeScript project keeps its own configuration contract.
 */
function discoverVibeLangProjectInputs(project: string): VibeLangProjectInputs | { readonly failure: CliDiagnostic } {
  const requested = resolve(project);
  const fileName = existsSync(requested) && statSync(requested).isDirectory()
    ? join(requested, "tsconfig.json")
    : requested;
  if (!existsSync(fileName)) {
    return { failure: { code: "VIBE6003", severity: "error", message: `no tsconfig.json at ${fileName}`, file: fileName } };
  }
  let discovered: NativeProjectConfigResult;
  try {
    discovered = getNativeCompiler().discoverProject({ path: fileName });
  } catch (error) {
    return {
      failure: {
        code: "VIBE6003",
        severity: "error",
        message: `project configuration could not be read: ${error instanceof Error ? error.message : String(error)}`,
        file: fileName,
      },
    };
  }
  const sources = new Map(discovered.configurations.map((configuration) => [configuration.path, configuration.text]));
  const diagnostics: CliDiagnostic[] = discovered.diagnostics.map((issue) => {
    const source = issue.file === undefined ? undefined : sources.get(issue.file);
    const position = source !== undefined && issue.span !== undefined ? authoredLineColumn(source, issue.span.start) : undefined;
    return {
      code: issue.code,
      severity: "error",
      message: issue.message,
      file: issue.file ?? fileName,
      ...(position === undefined ? {} : { line: position.line, column: position.column }),
    };
  });
  const text = sources.get(fileName) ?? readFileSync(fileName, "utf8");
  return {
    fileName,
    text,
    diagnostics,
    files: discovered.files.filter(isVibeLangFile),
    typeScriptFiles: discovered.files.filter((file) => !isVibeLangFile(file)),
    configDirectory: dirname(fileName),
    ...(discovered.configurations.length === 1 ? { configFile: { path: fileName, text } } : {}),
    ...(discovered.options.rootDir === "" ? {} : { rootDir: discovered.options.rootDir }),
    ...(discovered.options.outDir === "" ? {} : { outDir: discovered.options.outDir }),
    declaration: discovered.options.declaration,
    sourceMap: discovered.options.sourceMap,
    noEmit: discovered.options.noEmit,
  };
}

/**
 * The configuration handed to a frontend for a `-p` run with explicit
 * entries: the text-only validation, unchanged, whose findings and positions
 * the compiler-option route tests pin. Discovery's effective-configuration
 * findings gate the bare `-p` run, where the entries come from the
 * configuration itself.
 */
function projectConfigForEntries(requested: string):
  | { readonly fileName: string; readonly text: string; readonly diagnostics: readonly CliDiagnostic[]; readonly configFile: { readonly path: string; readonly text: string } }
  | { readonly failure: CliDiagnostic } {
  const config = readVibeLangProjectConfig(requested);
  if ("failure" in config) return config;
  return { ...config, configFile: { path: config.fileName, text: config.text } };
}

/** tsc's plain diagnostic line: `file(line,col): error TSnnnn: message`. */
const TSC_LOCATED_DIAGNOSTIC = /^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\): (?<severity>error|warning) (?<code>TS\d+): (?<message>.*)$/u;
const TSC_GLOBAL_DIAGNOSTIC = /^(?<severity>error|warning) (?<code>TS\d+): (?<message>.*)$/u;

/**
 * Type-check the TypeScript roots of a mixed project with the TypeScript
 * compiler itself, under the project's own configuration, and fold its
 * findings into the structured report. Routing the `.vibe` roots through the
 * checked frontend must not make a broken `plain.ts` disappear from
 * `vibe check -p`, and a refused project must not publish a partial build.
 */
function checkTypeScriptRoots(configFileName: string): { readonly ok: boolean; readonly results: readonly VibeLangFileResult[] } {
  const run = captureTypeScriptCompiler(["--noEmit", "--pretty", "false", "-p", configFileName], { cwd: dirname(configFileName) });
  const byFile = new Map<string, CliDiagnostic[]>();
  const record = (file: string, diagnostic: CliDiagnostic): void => {
    const list = byFile.get(file) ?? [];
    list.push(diagnostic);
    byFile.set(file, list);
  };
  for (const line of `${run.stdout}\n${run.stderr}`.split(/\r?\n/u)) {
    const located = TSC_LOCATED_DIAGNOSTIC.exec(line);
    if (located?.groups) {
      const file = resolve(dirname(configFileName), located.groups.file!);
      record(file, {
        code: located.groups.code!,
        severity: located.groups.severity === "warning" ? "warning" : "error",
        message: located.groups.message!,
        file,
        line: Number(located.groups.line),
        column: Number(located.groups.column),
      });
      continue;
    }
    const global = TSC_GLOBAL_DIAGNOSTIC.exec(line);
    if (global?.groups) {
      record(configFileName, {
        code: global.groups.code!,
        severity: global.groups.severity === "warning" ? "warning" : "error",
        message: global.groups.message!,
        file: configFileName,
      });
    }
  }
  const failed = run.status !== 0;
  if (failed && ![...byFile.values()].flat().some((diagnostic) => diagnostic.severity === "error")) {
    record(configFileName, {
      code: "VIBELANG_TYPESCRIPT",
      severity: "error",
      message: `the TypeScript compiler exited with status ${run.status}: ${(run.stderr || run.stdout || "no output").trim().slice(0, 4096)}`,
      file: configFileName,
    });
  }
  return {
    ok: !failed,
    results: [...byFile.entries()].map(([input, diagnostics]) => ({ input, diagnostics })),
  };
}

/**
 * Let a temporary output directory resolve the `vibelang` package the way an
 * installed consumer's project does.
 *
 * `vibe run` and `vibe test` redirect the `vibelang/runtime` seam at the
 * packaged file, but the derived-schema seam `vibelang/schema-runtime`
 * deliberately keeps its bare specifier (a resolvable local path would make the
 * frontend read `__vsSchema` as an untrusted foreign module), so a program
 * that derived a schema failed with ERR_MODULE_NOT_FOUND whenever no
 * `node_modules/vibelang` sat above its source: a checkout, a global install,
 * a scratch directory. The link points at this package's own root, whose
 * `exports` map already names every seam, so the emitted specifier resolves
 * to the same files an installed consumer would load.
 */
function stagePackageResolution(directory: string): void {
  const packageRoot = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]+$/, "");
  const modules = join(directory, "node_modules");
  mkdirSync(modules, { recursive: true });
  symlinkSync(packageRoot, join(modules, "vibelang"), process.platform === "win32" ? "junction" : "dir");
}

function reportVibeLangResults(results: readonly VibeLangFileResult[]): { ok: boolean; files: readonly VibeLangFileResult[] } {
  const ok = results.every((result) => !result.diagnostics.some((diagnostic) => diagnostic.severity === "error"));
  if (!ok) process.exitCode = 1;
  return { ok, files: results };
}

/* -------------------------------------------------------------------------- */
/* vibe format                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Extensions the whitespace-only formatter accepts. `.vibe` additionally goes
 * through VibeLang construct masking; the others are ordinary TypeScript or
 * JavaScript for which the masking pass is a no-op. JSX variants are refused
 * because the formatter scans in the standard language variant.
 */
const FORMATTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".vibe", ".ts", ".mts", ".cts", ".js", ".mjs", ".cjs",
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
    `.${basename(absolute)}.vibelang-format-${randomBytes(8).toString("hex")}`,
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
      `vibe format accepts ${[...FORMATTABLE_EXTENSIONS].join(", ")} files: ${input}`,
    );
  }
  const snapshot = readBoundedUtf8File(input, MAX_CLI_SOURCE_BYTES, "source file");
  const result = formatVibeLangSource(snapshot.source, {
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

const TEST_PROTOCOL_PREFIX = "__VIBELANG_TEST_PROTOCOL_V1_";
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
    // A generator function is the one callable shape whose body does not run
    // when it is called: `f()` allocates an iterator and returns. Nothing here
    // drives that iterator, so before this refusal existed the runner counted
    // such a test in `discovered`, counted it in `passed`, and printed
    // `ok: true` for a body that never executed — a gate certifying work it
    // never did, in the shipped product's own test runner.
    //
    // Two spellings, so two checks. The export may *be* a generator function
    // (measured: `function*`, `async function*`, a bound generator, a Proxy
    // over one, and a generator method pulled off a class all report
    // `[object GeneratorFunction]` / `[object AsyncGeneratorFunction]`, because
    // a bound function inherits its target's prototype and a Proxy forwards the
    // `Symbol.toStringTag` read); or it may be an ordinary or `async` function
    // that *returns* a generator object, which the tag on the function cannot
    // see and only the returned value reveals.
    //
    // Refused rather than driven: what it would mean to run such a test — one
    // `next()`, exhaustion, which yielded value is the result — is unspecified,
    // and inventing a semantics here would be a second guess on top of the
    // first. This refuses in the same place and the same style as the arity
    // check below, so the author is told, by name, that the test did not run.
    "const GENERATOR_FUNCTION_TAGS = new Set(['[object GeneratorFunction]', '[object AsyncGeneratorFunction]'])",
    "const GENERATOR_VALUE_TAGS = new Set(['[object Generator]', '[object AsyncGenerator]'])",
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
    // `test*`, as the command description and `doctor` both say it: every
    // export whose name begins with `test`. The predicate was
    // `/^test(?:$|[A-Z0-9_])/`, an undocumented camel-case boundary rule, and
    // every name it rejected was `continue`d — not run, not counted in
    // `discovered`, and named nowhere in the report. `tests` (the likeliest
    // accidental spelling), `testfoo`, `test$` and `testEcole` were all dropped
    // in silence, so a file whose five tests included one matching name
    // reported green. Nothing downstream could see it either: `discovered` is
    // cross-checked only against `passed` and `tests.length`, never against how
    // many `test*` exports the module has.
    "    if (!/^test/.test(name) || typeof test !== 'function') continue",
    "    discovered += 1",
    "    const label = `${moduleLabel}#${name}`",
    "    try {",
    "      if (test.length !== 0) throw new TypeError('exported VibeLang test functions must take zero arguments')",
    "      if (GENERATOR_FUNCTION_TAGS.has(Object.prototype.toString.call(test))) {",
    "        throw new TypeError('exported VibeLang test functions must not be generator functions: calling one allocates an iterator and runs none of the body')",
    "      }",
    "      const value = await test()",
    "      if (GENERATOR_VALUE_TAGS.has(Object.prototype.toString.call(value))) {",
    "        throw new TypeError('an exported VibeLang test function must not return a generator: its body has not run')",
    "      }",
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

// A raw-source command owns stdout, but still lets the event loop and runtime
// finish normally. Forced exit can interrupt pending runtime shutdown work.
let rawStdoutWritten = false;
const cli = Cli.create("vibe", { version, description: "VibeLang: the programming language for agents" })
  .command("compile", {
    args: files,
    options: backendCompileOptions,
    alias: { project: "p", watch: "w" },
    description: "Compile .vibe with the checked frontend, or delegate TS/JS to TypeScript",
    hint: "Use vibec when exact raw tsc argument compatibility is required.",
    async run(context) {
      let inputFiles = context.args.files;
      const { backend, ...options } = context.options;
      const bare = inputFiles === undefined || inputFiles.length === 0;
      const project = options.project === undefined || !bare ? undefined : discoverVibeLangProjectInputs(options.project);
      if (project && "failure" in project) {
        return context.error({ code: project.failure.code, exitCode: 2, message: project.failure.message });
      }
      let discovered: VibeLangProjectInputs | undefined;
      if (project) {
        if (project.diagnostics.length > 0) {
          return reportVibeLangResults([{ input: project.fileName, diagnostics: project.diagnostics }]);
        }
        if (project.files.length > 0) {
          discovered = project;
          inputFiles = [...project.files];
        }
      }
      if (backend === "js" && !inputFiles?.some(isVibeLangFile)) {
        return finishCompiler(runTypeScriptCompiler(compilerArgs(inputFiles, options)));
      }
      if (backend === "go" && !inputFiles?.some(isVibeLangFile)) {
        return context.error({
          code: "VIBELANG_GO_INPUT",
          exitCode: 2,
          message: "--backend go currently accepts .vibe inputs only; use --backend js for TypeScript or JavaScript inputs",
        });
      }
      const vibelangInputs = inputFiles!;
      if (containsMixedInputs(vibelangInputs)) {
        return context.error({ code: "MIXED_FRONTENDS", exitCode: 2, message: "compile .vibe and TypeScript inputs in separate invocations" });
      }
      const unsupported = unsupportedVibeLangOptions(options, new Set(["outDir", "rootDir", "noEmit", "declaration", "sourceMap", "project"]));
      if (unsupported.length > 0) {
        return context.error({
          code: "UNSUPPORTED_VIBELANG_OPTION",
          exitCode: 2,
          message: `.vibe compile does not support ${unsupported.join(", ")}; supported options are --project, --outDir, --rootDir, --declaration, --sourceMap, and --noEmit`,
        });
      }
      const compileConfig = discovered ?? (options.project === undefined ? undefined : projectConfigForEntries(options.project));
      if (compileConfig && "failure" in compileConfig) {
        return context.error({ code: compileConfig.failure.code, exitCode: 2, message: compileConfig.failure.message });
      }
      if (compileConfig && compileConfig.diagnostics.length > 0) {
        return reportVibeLangResults([{ input: compileConfig.fileName, diagnostics: compileConfig.diagnostics }]);
      }
      const outDir = options.outDir ?? discovered?.outDir;
      const emit = !options.noEmit && !(discovered?.noEmit ?? false);
      const collision = duplicateVibeLangOutput(vibelangInputs, outDir);
      if (collision) {
        return context.error({
          code: "DUPLICATE_VIBELANG_OUTPUT",
          exitCode: 2,
          message: `${collision.inputs.join(" and ")} both emit ${collision.output}`,
        });
      }
      if (options.noEmit && (options.declaration || options.sourceMap)) {
        return context.error({
          code: "CONFLICTING_VIBELANG_OPTIONS",
          exitCode: 2,
          message: ".vibe compile cannot combine --noEmit with --declaration or --sourceMap",
        });
      }
      // The TypeScript roots of a mixed project are checked first, under the
      // project's own configuration: a refused project publishes nothing.
      if (discovered && discovered.typeScriptFiles.length > 0) {
        const typescript = checkTypeScriptRoots(discovered.fileName);
        if (!typescript.ok) return reportVibeLangResults(typescript.results);
      }
      try {
        const compile = backend === "go" ? compileGoVibeLangFiles : compileVibeLangFiles;
        return reportVibeLangResults(await compile(vibelangInputs, {
          ...(compileConfig && !("failure" in compileConfig) && compileConfig.configFile
            ? { configFile: compileConfig.configFile }
            : {}),
          outDir,
          rootDir: options.rootDir ?? discovered?.rootDir ?? discovered?.configDirectory,
          emit,
          declaration: options.declaration || (emit && discovered?.declaration) || undefined,
          sourceMap: options.sourceMap || (emit && discovered?.sourceMap) || undefined,
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
    description: "Check .vibe rows and emitted TS, or type-check TS/JS without emitting",
    async run(context) {
      let inputFiles = context.args.files;
      const { backend, ...options } = context.options;
      const bare = inputFiles === undefined || inputFiles.length === 0;
      const project = options.project === undefined || !bare ? undefined : discoverVibeLangProjectInputs(options.project);
      if (project && "failure" in project) {
        return context.error({ code: project.failure.code, exitCode: 2, message: project.failure.message });
      }
      let discovered: VibeLangProjectInputs | undefined;
      if (project) {
        if (project.diagnostics.length > 0) {
          return reportVibeLangResults([{ input: project.fileName, diagnostics: project.diagnostics }]);
        }
        if (project.files.length > 0) {
          discovered = project;
          inputFiles = [...project.files];
        }
      }
      if (backend === "js" && !inputFiles?.some(isVibeLangFile)) {
        return finishCompiler(runTypeScriptCompiler(["--noEmit", ...compilerArgs(inputFiles, options)]));
      }
      if (backend === "go" && !inputFiles?.some(isVibeLangFile)) {
        return context.error({
          code: "VIBELANG_GO_INPUT",
          exitCode: 2,
          message: "--backend go currently accepts .vibe inputs only; use --backend js for TypeScript or JavaScript inputs",
        });
      }
      const vibelangInputs = inputFiles!;
      if (containsMixedInputs(vibelangInputs)) {
        return context.error({ code: "MIXED_FRONTENDS", exitCode: 2, message: "check .vibe and TypeScript inputs in separate invocations" });
      }
      const unsupported = unsupportedVibeLangOptions(options, new Set<keyof CompileOptions>(["rootDir", "project"]));
      if (unsupported.length > 0) {
        return context.error({
          code: "UNSUPPORTED_VIBELANG_OPTION",
          exitCode: 2,
          message: `.vibe check does not support ${unsupported.join(", ")}`,
        });
      }
      const checkConfig = discovered ?? (options.project === undefined ? undefined : projectConfigForEntries(options.project));
      if (checkConfig && "failure" in checkConfig) {
        return context.error({ code: checkConfig.failure.code, exitCode: 2, message: checkConfig.failure.message });
      }
      if (checkConfig && checkConfig.diagnostics.length > 0) {
        return reportVibeLangResults([{ input: checkConfig.fileName, diagnostics: checkConfig.diagnostics }]);
      }
      const typescript = discovered && discovered.typeScriptFiles.length > 0
        ? checkTypeScriptRoots(discovered.fileName)
        : undefined;
      try {
        const compile = backend === "go" ? compileGoVibeLangFiles : compileVibeLangFiles;
        const results = await compile(vibelangInputs, {
          ...(checkConfig && !("failure" in checkConfig) && checkConfig.configFile
            ? { configFile: checkConfig.configFile }
            : {}),
          rootDir: options.rootDir ?? discovered?.rootDir ?? discovered?.configDirectory,
          emit: false,
        });
        return reportVibeLangResults([...(typescript?.results ?? []), ...results]);
      } catch (error) {
        return backendFailure(context, error);
      }
    },
  })
  .command("run", {
    args: files,
    options: z.object({ backend: backendOption }),
    description: "Compile and run one .vibe file under Node (prototype subset)",
    async run(context) {
      const [input, ...programArguments] = requireInputs(context.args.files);
      if (!isVibeLangFile(input)) {
        return context.error({ code: "INVALID_INPUT", exitCode: 2, message: "vibe run requires a .vibe input" });
      }
      let temporary: string | undefined;
      try {
        const inputPath = realpathSync(resolve(input));
        temporary = mkdtempSync(join(dirname(inputPath), ".vibelang-run-"));
        writeFileSync(join(temporary, "package.json"), "{\"type\":\"module\"}\n");
        stagePackageResolution(temporary);
        const runtime = fileURLToPath(new URL("../poc/dist/runtime/index.js", import.meta.url));
        // The derived-schema seam deliberately keeps its package specifier here:
        // a resolvable local path would make the frontend read `__vsSchema` as an
        // untrusted foreign module. It resolves through the package link staged
        // above, exactly as it does from an installed consumer's node_modules.
        const results = context.options.backend === "go"
          ? compileGoVibeLangFiles([input], { outDir: temporary })
          : await compileVibeLangFiles([input], { outDir: temporary, runtimeImport: runtime });
        const report = reportVibeLangResults(results);
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
      const nonVibeLang = inputs.filter((file) => !isVibeLangFile(file));
      if (nonVibeLang.length > 0) {
        return context.error({
          code: "INVALID_INPUT",
          exitCode: 2,
          message: `vibe inspect currently accepts only .vibe files: ${nonVibeLang.join(", ")}`,
        });
      }
      let inspected: Array<{ file: string; language: ReturnType<typeof analyzeSource> }>;
      try {
        const project = loadVibeLangProject(inputs);
        const assetContext = sourceAssetCompilerForProject(project.rootDir);
        const sourceAssets = await compileSourceAssetModules({
          compiler: assetContext.compiler,
          sources: project.sources,
        });
        if (!sourceAssets.ok) {
          process.exitCode = 1;
          return {
            ok: false,
            code: "VIBELANG_ASSET_IMPORT",
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
        return backendFailure(context, error);
      }
      const ok = inspected.every((item) =>
        !item.language.diagnostics.some((diagnostic) => diagnostic.severity === "error"));
      if (!ok) process.exitCode = 1;
      return { ok, files: inspected };
    },
  })
  // The September 6 owner decision restores the full keyed graph as the
  // inspection contract. Historical Manifest inspection is explicitly named;
  // a refused keyed Plan never falls back to it or to executable-body replay.
  .command("plan", {
    args: files,
    options: z.object({
      profile: z.enum(["keyed", "manifest-compat"]).default("keyed")
        .describe("Keyed graph inspection, or explicitly historical Effect Manifest inspection"),
      input: z.string().optional().describe("JSON file containing the exact Flow input"),
      providers: z.string().optional().describe("JSON file containing explicit provider/code/tier/effect declarations (not execution authority)"),
      planId: z.string().optional().describe("Explicit identity for the inspected Plan"),
      flowId: z.string().optional().describe("Override the declaration-derived Flow identity"),
      flowVersion: z.number().int().positive().optional().describe("Positive Flow version (default: 1)"),
      exportName: z.string().optional().describe("Select the exported source Flow"),
      rootDir: z.string().optional().describe("Bound source-module discovery and project-relative identities"),
      bindings: z.string().optional().describe("Historical Action bindings; requires --profile manifest-compat"),
      outFile: z.string().optional().describe("Write the native canonical inspection artifact after successful checking"),
    }),
    description: "Publish a checked keyed Plan without executing authored code or authorizing providers",
    run(context) {
      try {
        const input = requireOneInput(context.args.files, "vibe plan");
        if (!isVibeLangFile(input)) throw new TypeError("vibe plan requires a .vibe input");
        const absolute = realpathSync(resolve(input));
        if (!isVibeLangFile(absolute)) throw new TypeError("vibe plan requires a canonical .vibe input");
        if (context.options.profile === "keyed") {
          if (context.options.bindings !== undefined) {
            throw new TypeError("--bindings is historical Manifest configuration; use --profile manifest-compat explicitly");
          }
          if (!context.options.input || !context.options.providers || !context.options.planId) {
            throw new TypeError("vibe plan requires --input <input.json>, --providers <providers.json>, and --planId <id>");
          }
          const project = loadVibeLangProject([absolute], context.options.rootDir, {
            maximumFileBytes: MAX_CLI_SOURCE_BYTES,
            maximumTotalBytes: MAX_CLI_SOURCE_BYTES,
            maximumFiles: 257,
            preserveBOM: true,
          });
          const fileName = relative(project.rootDir, absolute).split(sep).join("/");
          const entry = project.sources.find(source => source.fileName === fileName)!;
          const value = readBoundedUtf8File(context.options.input, 16 * 1024 * 1024, "durable input file", true);
          const providers = readBoundedUtf8File(context.options.providers, 16 * 1024 * 1024, "durable providers file", true);
          // Preserve the original JSON text: Go, not JSON.parse in the host,
          // owns duplicate-key, number, Unicode and provider-policy validation.
          const result = getNativeCompiler().compileKeyedPlanSource({
            source: entry.source, fileName,
            dependencies: project.sources.filter(source => source.fileName !== fileName),
            ...(context.options.exportName === undefined ? {} : { exportName: context.options.exportName }),
            flowId: context.options.flowId ?? "", flowVersion: context.options.flowVersion ?? 1,
            planId: context.options.planId, inputJson: value.source, providersJson: providers.source,
          });
          if (!result.ok) {
            process.exitCode = 1;
            return { ok: false, profile: "keyed", file: absolute, diagnostics: result.diagnostics };
          }
          const plan = JSON.parse(result.planJson) as { readonly planId: string; readonly digest: string };
          const artifact = writeDurableInspection(context.options.outFile, result.planJson,
            [...project.runtimeSeeds.map(source => source.fileName), value.fileName, providers.fileName], "Plan");
          return { ok: true, profile: "keyed", file: absolute, rootDir: project.rootDir,
            artifact, planId: plan.planId, digest: plan.digest, plan };
        }
        if ([context.options.input, context.options.providers, context.options.planId, context.options.flowId,
          context.options.flowVersion, context.options.exportName, context.options.rootDir].some(value => value !== undefined)) {
          throw new TypeError("--profile manifest-compat accepts only --bindings and --outFile, not keyed Plan options");
        }
        if (!context.options.bindings) throw new TypeError("vibe plan requires --bindings <actions.json>");
        const source = readBoundedUtf8File(input, MAX_CLI_SOURCE_BYTES, "durable source file");
        const config = readDurablePlanConfig(context.options.bindings);
        const result = compileEffectManifest(source.source, {
          fileName: basename(absolute),
          flowId: config.flowId,
          flowVersion: config.flowVersion,
          actions: config.actions,
        });
        if (!result.ok) {
          process.exitCode = 1;
          return { ok: false, file: absolute, diagnostics: result.diagnostics };
        }
        const artifact = writeDurableInspection(context.options.outFile, canonicalJson(result.manifest),
          [absolute, config.fileName], "Manifest");
        return {
          ok: true,
          profile: "manifest-compat",
          file: absolute,
          artifact,
          digest: result.manifest.digest,
          manifest: result.manifest,
        };
      } catch (error) {
        return context.error({
          code: "VIBELANG_PLAN_ERROR",
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
    args: z.object({}),
    options: z.object({
      force: z.boolean().optional().describe("Overwrite files that already exist"),
    }),
    description: "Create a VibeLang project: a compliant tsconfig.json and a main.vibe that prints",
    hint: "Writes tsconfig.json, main.vibe, and stdout.ts into the current directory, then `vibe check main.vibe` and `vibe run main.vibe` work as written. Existing files are kept unless --force is given.",
    examples: [
      { args: {}, description: "Scaffold a project in the current directory" },
      { args: {}, options: { force: true }, description: "Overwrite the scaffold files" },
    ],
    run(context) {
      // Previously this delegated to `tsc --init`. That produced a tsconfig the
      // VibeLang checker then refused on two counts (an unclassified option and
      // a missing mandatory one), which made the first documented command fail.
      // The scaffold below is the smallest project that prints something:
      // nothing is ambient in `.vibe`, so output goes through a capability whose
      // one host touch lives in ordinary TypeScript behind a trust claim.
      const files: Record<string, string> = {
        "tsconfig.json": JSON.stringify(
          {
            compilerOptions: {
              target: "esnext",
              module: "esnext",
              moduleResolution: "bundler",
              // The six mandatory soundness options; `vibe check -p` refuses a
              // project that weakens any of them.
              strict: true,
              noUncheckedIndexedAccess: true,
              exactOptionalPropertyTypes: true,
              isolatedModules: true,
              verbatimModuleSyntax: true,
              useDefineForClassFields: true,
              allowImportingTsExtensions: true,
              noEmit: true,
              skipLibCheck: true,
            },
            include: ["**/*.vibe", "**/*.ts"],
          },
          null,
          2,
        ) + "\n",
        "main.vibe": [
          'import { Context } from "vibelang/context"',
          'import { Layer } from "vibelang/provider"',
          'import { writeLine } from "./stdout.ts"',
          "",
          "// Nothing is ambient in .vibe: console, process, the clock, and the network",
          "// all arrive as capabilities. This one writes a line of output.",
          "abstract class Console extends Context {",
          "  abstract info(message: string): void",
          "}",
          "",
          "class StdoutConsole extends Console {",
          "  info(message: string): void {",
          "    writeLine(message)",
          "  }",
          "}",
          "",
          "class NotFound extends Error {}",
          "",
          "// A fallible function returns Result<A, E>. A plain return is the success",
          "// value; a thrown Error is the failure value. Callers must handle it.",
          "function greeting(id: number): Result<string, NotFound> {",
          "  if (id !== 1) throw new NotFound(`no user ${id}`)",
          '  return "hello, Ada"',
          "}",
          "",
          "const App = Layer.succeed(Console, new StdoutConsole())",
          "",
          "Layer.provide(App, () => {",
          "  const console = Console.context()",
          "  greeting(1).match({",
          "    ok: text => console.info(text),",
          "    error: error => console.info(`failed: ${error.message}`),",
          "  })",
          "})",
          "",
        ].join("\n"),
        "stdout.ts": [
          "/**",
          " * The one place this program touches the host. Ordinary TypeScript, with a",
          " * trust claim the compiler honours: importing it adds no panic channel.",
          " * @module",
          " * @throws {never}",
          " */",
          "",
          "/** @throws {never} */",
          "export function writeLine(text: string): void {",
          "  console.log(text)",
          "}",
          "",
        ].join("\n"),
      };
      const written: string[] = [];
      const skipped: string[] = [];
      for (const [name, text] of Object.entries(files)) {
        const target = resolve(name);
        if (existsSync(target) && !context.options.force) {
          skipped.push(name);
          continue;
        }
        writeFileSync(target, text);
        written.push(name);
      }
      return {
        ok: true,
        written,
        skipped,
        next: ["vibe check main.vibe", "vibe run main.vibe"],
      };
    },
  })
  .command("format", {
    args: files,
    options: z.object({
      check: z.boolean().optional().describe("List unformatted files and exit nonzero without writing"),
      stdout: z.boolean().optional().describe("Print the formatted source instead of writing files"),
      indentSize: z.number().int().min(1).max(8).optional().describe("Spaces per indentation level (default 2)"),
    }),
    description: "Format VibeLang and TypeScript sources deterministically",
    hint: "Formatting is whitespace-only and idempotent; a file that cannot be formatted soundly is reported, never rewritten.",
    examples: [
      { args: { files: ["src/app.vibe"] }, description: "Format one module in place" },
      { args: { files: ["src/app.vibe"] }, options: { check: true }, description: "Fail if the module is unformatted" },
      { args: { files: ["src/app.vibe"] }, options: { stdout: true }, description: "Print the formatted module" },
    ],
    run(context) {
      const inputs = context.args.files;
      if (!inputs || inputs.length === 0) {
        return context.error({ code: "INVALID_INPUT", exitCode: 2, message: "vibe format requires at least one input file" });
      }
      if (context.options.check && context.options.stdout) {
        return context.error({ code: "INVALID_INPUT", exitCode: 2, message: "vibe format --check and --stdout are mutually exclusive" });
      }
      let results: FormatFileResult[];
      try {
        results = inputs.map((input) => formatOneFile(input, context.options.indentSize));
      } catch (error) {
        return context.error({
          code: "VIBELANG_FORMAT_ERROR",
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
          rawStdoutWritten = true;
          return;
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
          code: "VIBELANG_FORMAT_WRITE_ERROR",
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
    description: "Compile and run exported zero-argument test* functions (every exported function whose name begins with test; generator functions are refused)",
    async run(context) {
      const inputs = context.args.files;
      if (!inputs || inputs.length === 0) {
        return context.error({ code: "INVALID_INPUT", exitCode: 2, message: "vibe test requires at least one .vibe input" });
      }
      const nonVibeLang = inputs.filter((file) => !isVibeLangFile(file));
      if (nonVibeLang.length > 0) {
        return context.error({
          code: "INVALID_INPUT",
          exitCode: 2,
          message: `vibe test currently accepts only .vibe files: ${nonVibeLang.join(", ")}`,
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
              `vibe test received the same canonical module more than once: ${duplicate} and ${canonicalInputs[index]}`,
            );
          }
        }
        temporary = mkdtempSync(join(commonSourceRoot(canonicalInputs), ".vibelang-test-"));
        writeFileSync(join(temporary, "package.json"), "{\"type\":\"module\"}\n");
        stagePackageResolution(temporary);
        const runtime = fileURLToPath(new URL("../poc/dist/runtime/index.js", import.meta.url));
        const results = await compileVibeLangFiles(inputs, {
          outDir: temporary,
          runtimeImport: runtime,
          sourceBudget: {
            maximumFileBytes: MAX_CLI_SOURCE_BYTES,
            maximumTotalBytes: MAX_TEST_PROJECT_BYTES,
            maximumFiles: MAX_TEST_PROJECT_FILES,
          },
        });
        const report = reportVibeLangResults(results);
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
        const runner = join(temporary, "__vibelang_test_runner__.mjs");
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
          code: "VIBELANG_TEST_ERROR",
          exitCode: 2,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (temporary) rmSync(temporary, { recursive: true, force: true });
      }
    },
  })
  .command("lsp", {
    description: "Start the VibeLang language server on stdio (LSP over JSON-RPC 2.0)",
    hint: "Bounded on purpose: one workspace folder, full-document sync, and diagnostics, hover, definition, and formatting only.",
    async run() {
      // The language server owns stdout for the whole session, so no structured
      // envelope may be printed after it: this command terminates the process
      // itself once the client's `exit` notification arrives, after flushing.
      const code = await startVibeLangLanguageServer().closed;
      await new Promise<void>((settle) => { process.stdout.write("", () => { settle(); }); });
      process.exit(code);
    },
  })
  .command("doctor", {
    description: "Inspect installed backends and implemented prototype surfaces",
    run() {
      const nativeCompiler = resolveTypeScriptCompiler();
      const nativeTypeScript = probeExecutable(nativeCompiler, ["--typescript", "--version"]);
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
        vibelang: version,
        node: process.version,
        nativeCompiler,
        nativeTypeScript,
        compilerPipeline: {
          generatedChecking: "native-go",
          declarations: "native-go",
          languageFrontend: "native-go",
        },
        tools: {
          deno: probeExecutable("deno"),
          zig: probeExecutable("zig", ["version"]),
          rustc: probeExecutable("rustc", ["--version"]),
          go: probeExecutable("go", ["version"]),
        },
        surfaces: {
          vibelangCompile: "cross-module prototype with declarations and composed source maps",
          vibelangCheck: "cross-module checked-row prototype",
          vibelangRun: "Node prototype subset",
          inspectRowsAndTargets: "prototype",
          comptimeAndAssets: "bounded comptime functions, target selection, tracked text embed, and static assets; loaders remain programmatic",
          codingAgent: "programmatic API",
          durablePlanCompiler: "static vibe plan command and programmatic API",
          durableExecutor: "Bun-only subpath: vibelang/durable/bun",
          languageServer: "stdio LSP: diagnostics, hover rows, definition, formatting; one workspace folder, full-document sync",
          formatter: "idempotent whitespace-only .vibe/TypeScript formatter with VibeLang construct masking",
          testRunner: "exported zero-argument test* prototype: every exported function whose name begins with test, generator functions refused",
        },
        packagedRuntime,
      };
    },
  });

cli.command((await import("./durable-cli.js")).durableCli);

await cli.serve(undefined, {
  stdout(text) {
    if (!rawStdoutWritten) process.stdout.write(text);
  },
});
