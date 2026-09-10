import { spawn, spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { getNativeCompiler } from "../compiler/native.ts";
import type {
  AssetLoader,
  LoaderAsset,
  LoaderContext,
  TypedAssetModule,
} from "./assets.ts";
import { cloneJsonValue, digest, stableClone } from "./stable.ts";
import { decodeComptimeValue, encodeComptimeValue, type ComptimeValueGraph } from "./comptime-value.ts";
import type { StableJson } from "./stable.ts";

const LOADER_PROTOCOL_VERSION = 2;
const authenticAssetLoaders = new WeakSet<object>();

/**
 * What the sandbox does with a module of this name — the one question every
 * caller used to answer for itself, three different ways.
 *
 * `loader-runner.js` evaluates exactly one ES module, from a
 * `data:text/javascript` URL, and resolves no imports at all. So a filename
 * that *declares* CommonJS (`.cts`, `.cjs`) can never run there — CommonJS
 * output such as `exports.default = …` has no `exports` binding in an ES
 * module. A `.tsx` file would need a JSX transform this seam does not request, and a `.d.ts`
 * file has no emit. Those return `undefined` and fail closed at the boundary
 * instead of passing every compile-time gate and dying in the sandbox.
 */
export type SandboxModuleKind = "typescript" | "javascript";

const SANDBOX_TYPESCRIPT_EXTENSIONS = Object.freeze([".ts", ".mts"]);
const SANDBOX_JAVASCRIPT_EXTENSIONS = Object.freeze([".js", ".mjs"]);

/** Every filename extension the sandbox can execute, lowercase. */
export const SANDBOX_MODULE_EXTENSIONS: readonly string[] = Object.freeze([
  ...SANDBOX_TYPESCRIPT_EXTENSIONS,
  ...SANDBOX_JAVASCRIPT_EXTENSIONS,
]);

export function sandboxModuleKind(fileName: string): SandboxModuleKind | undefined {
  if (typeof fileName !== "string") return undefined;
  const base = (fileName.replaceAll("\\", "/").split("/").pop() ?? "").toLowerCase();
  // `extname` reports `.ts` for a declaration file, which has no emit.
  if (/\.d\.[cm]?tsx?$/.test(base)) return undefined;
  const extension = extname(base);
  if (SANDBOX_TYPESCRIPT_EXTENSIONS.includes(extension)) return "typescript";
  if (SANDBOX_JAVASCRIPT_EXTENSIONS.includes(extension)) return "javascript";
  // A module path with no extension at all reaches the sandbox as authored.
  if (extension === "") return "javascript";
  return undefined;
}

/**
 * The environment the sandbox process is given, pinned rather than inherited.
 *
 * `--deny-env` stops the *loader* from reading `Deno.env`; it does not stop the
 * runtime from reading its own environment. `TZ` reaches `Date.parse` and every
 * locale-sensitive builtin, and `DENO_V8_FLAGS` injects arbitrary V8 flags into
 * the sandbox — both changed observable loader output while
 * `implementationDigest` stayed byte-identical, which is cache poisoning across
 * machines. Pinning by allowlist keeps whichever variable nobody has thought of
 * yet from becoming the next one, and the pin is folded into the sandbox
 * identity below so it is part of every cache key it produces.
 */
const SANDBOX_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze({
  TZ: "UTC",
  LC_ALL: "C",
  LANG: "C",
});

/**
 * Only what the child needs to start. `PATH` resolves a bare `deno` command
 * name; the Windows entries are what `CreateProcess` itself requires. None of
 * them is observable from inside the sandbox, so none belongs in the digest.
 */
const SANDBOX_INHERITED_ENVIRONMENT = Object.freeze(["PATH", "SystemRoot", "ComSpec", "PATHEXT"]);

function sandboxEnvironment(): Record<string, string> {
  const environment: Record<string, string> = { ...SANDBOX_ENVIRONMENT };
  for (const key of SANDBOX_INHERITED_ENVIRONMENT) {
    const value = process.env[key];
    if (typeof value === "string") environment[key] = value;
  }
  return environment;
}

/** Reject structurally forged loaders at the compiler trust boundary. */
export function assertSandboxedLoader(loader: AssetLoader): void {
  if (loader === null || typeof loader !== "object" || !authenticAssetLoaders.has(loader)) {
    throw new TypeError("third-party asset loaders must be created by createSandboxedLoader()");
  }
}

export interface SandboxedLoaderOptions {
  readonly id: string;
  readonly version: string;
  readonly extensions: readonly string[];
  readonly types?: readonly string[];
  /** JavaScript ESM file exporting the loader function. */
  readonly modulePath: string;
  readonly exportName?: string;
  /**
   * Compiler-lowered replacement for the authored module body. The authored
   * file is still snapshotted and enters `implementationDigest`; only the text
   * handed to the sandbox is replaced.
   *
   * This exists for the provisional source-level `comptime.loader(...)`
   * registration in `loader-registration.ts`, where the authored file imports
   * the compiler-owned comptime module that cannot exist inside a
   * no-permission sandbox. Ordinary loader modules never set it.
   */
  readonly loweredSource?: string;
  readonly denoPath?: string;
  readonly timeoutMs?: number;
  readonly memoryMb?: number;
  readonly maxOutputBytes?: number;
  readonly maxInputBytes?: number;
  readonly maxRequests?: number;
  readonly maxConcurrentRequests?: number;
}

interface RunnerRequest {
  readonly kind: "request";
  readonly id: number;
  readonly method: "readText" | "readBytes" | "import";
  readonly specifier: string;
  readonly options?: Record<string, unknown>;
}

interface RunnerResult {
  readonly kind: "result";
  readonly value: unknown;
}

interface RunnerError {
  readonly kind: "error";
  readonly name?: string;
  readonly message: string;
  readonly stack?: string;
}

type RunnerMessage = RunnerRequest | RunnerResult | RunnerError;

/**
 * Load third-party comptime code in a fresh, zero-permission Deno process.
 *
 * The module source is snapshotted when the loader is registered and becomes
 * part of its implementation digest. It receives no filesystem path or host
 * objects; all dependency access crosses a bounded JSON-lines protocol and is
 * resolved by AssetCompiler's real-path authority checks.
 */
export function createSandboxedLoader(options: SandboxedLoaderOptions): AssetLoader {
  const denoPath = options.denoPath ?? "deno";
  const runnerPath = fileURLToPath(new URL("./loader-runner.js", import.meta.url));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const memoryMb = options.memoryMb ?? 128;
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
  const maxInputBytes = options.maxInputBytes ?? 8 * 1024 * 1024;
  const maxRequests = options.maxRequests ?? 256;
  const maxConcurrentRequests = options.maxConcurrentRequests ?? Math.max(1, Math.min(16, maxRequests));
  if (typeof options.id !== "string" || typeof options.version !== "string" || !options.id.trim() || !options.version.trim()) {
    throw new TypeError("sandboxed loader id and version must be non-empty");
  }
  validateLimits(timeoutMs, memoryMb, maxOutputBytes, maxInputBytes, maxRequests, maxConcurrentRequests);
  const compiled = compileSandboxedModule(
    options.modulePath,
    options.exportName,
    Math.floor(maxInputBytes * 3 / 4),
    options.loweredSource,
  );
  const { kind, originalSource, executable, source, exportName } = compiled;
  const sandbox = inspectSandbox(denoPath, runnerPath);

  const loader = Object.freeze({
    id: options.id,
    version: options.version,
    extensions: Object.freeze([...options.extensions]),
    types: options.types ? Object.freeze([...options.types]) : undefined,
    implementationDigest: digest({
      protocol: LOADER_PROTOCOL_VERSION,
      source: originalSource,
      // Only a compiler-lowered registration contributes this field, so an
      // ordinary sandboxed loader keeps the identity it already had.
      ...(options.loweredSource === undefined ? {} : { lowered: executable }),
      // Labelled from the module kind, not from whether the transpile happened
      // to be an identity transform: a TypeScript loader whose emit equals its
      // source still depends on the native compiler. JavaScript validation is
      // native too; no old parser identity can survive in an accepted cache key.
      compiler: { kind, native: getNativeCompiler().identity, transport: getNativeCompiler().transportDigest },
      exportName,
      sandbox,
      limits: { timeoutMs, memoryMb, maxOutputBytes, maxInputBytes, maxRequests, maxConcurrentRequests },
    }),
    load(asset, context) {
      return executeSandboxedModule({
        denoPath,
        runnerPath,
        source,
        exportName,
        timeoutMs,
        memoryMb,
        maxOutputBytes,
        maxInputBytes,
        maxRequests,
        maxConcurrentRequests,
        invocation: { mode: "loader", asset },
        context,
      }).then((value) => value as unknown as TypedAssetModule);
    },
  } satisfies AssetLoader);
  authenticAssetLoaders.add(loader);
  return loader;
}

export interface SandboxedComptimeModuleOptions {
  readonly id: string;
  readonly version: string;
  readonly modulePath: string;
  readonly exportName?: string;
  readonly denoPath?: string;
  readonly timeoutMs?: number;
  readonly memoryMb?: number;
  readonly maxOutputBytes?: number;
  readonly maxInputBytes?: number;
  readonly maxRequests?: number;
  readonly maxConcurrentRequests?: number;
}

export interface SandboxedComptimeModule {
  readonly id: string;
  readonly version: string;
  readonly sourcePath: string;
  readonly implementationDigest: string;
  evaluate(args: readonly StableJson[], context: LoaderContext): Promise<StableJson>;
}

const authenticComptimeModules = new WeakSet<object>();

export function assertSandboxedComptimeModule(module: SandboxedComptimeModule): void {
  if (module === null || typeof module !== "object" || !authenticComptimeModules.has(module)) {
    throw new TypeError("comptime evaluation requires a module created by createSandboxedComptimeModule()");
  }
}

/** Hermetic execution primitive used after the compiler resolves `comptime(...)`. */
export function createSandboxedComptimeModule(
  options: SandboxedComptimeModuleOptions,
): SandboxedComptimeModule {
  const denoPath = options.denoPath ?? "deno";
  const runnerPath = fileURLToPath(new URL("./loader-runner.js", import.meta.url));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const memoryMb = options.memoryMb ?? 128;
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
  const maxInputBytes = options.maxInputBytes ?? 8 * 1024 * 1024;
  const maxRequests = options.maxRequests ?? 256;
  const maxConcurrentRequests = options.maxConcurrentRequests ?? Math.max(1, Math.min(16, maxRequests));
  if (typeof options.id !== "string" || typeof options.version !== "string" || !options.id.trim() || !options.version.trim()) {
    throw new TypeError("sandboxed comptime module id and version must be non-empty");
  }
  validateLimits(timeoutMs, memoryMb, maxOutputBytes, maxInputBytes, maxRequests, maxConcurrentRequests);
  const compiled = compileSandboxedModule(options.modulePath, options.exportName, Math.floor(maxInputBytes * 3 / 4));
  const implementationDigest = digest({
    protocol: LOADER_PROTOCOL_VERSION,
    source: compiled.originalSource,
    compiler: { kind: compiled.kind, native: getNativeCompiler().identity, transport: getNativeCompiler().transportDigest },
    exportName: compiled.exportName,
    sandbox: inspectSandbox(denoPath, runnerPath),
    limits: { timeoutMs, memoryMb, maxOutputBytes, maxInputBytes, maxRequests, maxConcurrentRequests },
  });
  const module = Object.freeze({
    id: options.id,
    version: options.version,
    sourcePath: compiled.modulePath,
    implementationDigest,
    async evaluate(args: readonly StableJson[], context: LoaderContext) {
      const clonedArgs = cloneJsonValue(args, "comptime arguments") as StableJson[];
      return await executeSandboxedModule({
        denoPath,
        runnerPath,
        source: compiled.source,
        exportName: compiled.exportName,
        timeoutMs,
        memoryMb,
        maxOutputBytes,
        maxInputBytes,
        maxRequests,
        maxConcurrentRequests,
        invocation: { mode: "comptime", args: encodeComptimeValue(clonedArgs) },
        context,
      });
    },
  });
  authenticComptimeModules.add(module);
  return module;
}

function compileSandboxedModule(
  modulePathInput: string,
  exportNameInput = "default",
  maxSourceBytes: number,
  loweredSource?: string,
): {
  modulePath: string;
  kind: SandboxModuleKind;
  /** Authored bytes. Always part of the implementation digest. */
  originalSource: string;
  /** Text actually compiled and executed: the lowering when one was supplied. */
  executable: string;
  source: string;
  exportName: string;
} {
  if (typeof modulePathInput !== "string") throw new TypeError("sandboxed module path must be a string");
  const modulePath = realpathSync(modulePathInput);
  const kind = sandboxModuleKind(modulePath);
  if (kind === undefined) {
    throw new TypeError(
      `sandboxed module '${modulePath}' has no format the zero-permission sandbox can evaluate; ` +
      `it evaluates one ES module and resolves no imports, so use one of ${SANDBOX_MODULE_EXTENSIONS.join(", ")}`,
    );
  }
  const metadata = statSync(modulePath);
  if (!metadata.isFile() || metadata.size > maxSourceBytes) {
    throw new Error(`sandboxed module source exceeds ${maxSourceBytes} bytes or is not a regular file`);
  }
  const originalSource = readFileSync(modulePath, "utf8");
  if (Buffer.byteLength(originalSource) > maxSourceBytes) {
    throw new Error(`sandboxed module source exceeds ${maxSourceBytes} bytes`);
  }
  let executable = originalSource;
  if (loweredSource !== undefined) {
    if (typeof loweredSource !== "string") throw new TypeError("sandboxed module lowered source must be a string");
    if (Buffer.byteLength(loweredSource) > maxSourceBytes) {
      throw new Error(`sandboxed module source exceeds ${maxSourceBytes} bytes`);
    }
    executable = loweredSource;
  }
  validateSandboxSource(executable, modulePath, kind);
  const source = kind === "typescript" ? transpileLoader(executable, modulePath) : executable;
  const exportName = exportNameInput;
  if (typeof exportName !== "string") throw new TypeError("sandboxed module export name must be a string");
  if (!/^[$A-Z_a-z][$\w]*$/.test(exportName) && exportName !== "default") {
    throw new TypeError(`invalid module export name '${exportName}'`);
  }
  return { modulePath, kind, originalSource, executable, source, exportName };
}

function validateSandboxSource(source: string, fileName: string, kind: SandboxModuleKind): void {
  const file = getNativeCompiler().inspect([{ path: kind === "typescript" ? "loader.mts" : "loader.mjs", text: source, scriptKind: kind }]).files[0]!;
  const diagnostics = file.diagnostics;
  if (diagnostics.length > 0) {
    throw new SyntaxError(`sandboxed loader ${fileName} did not parse: ${diagnostics
      .map((diagnostic) => diagnostic.message)
      .join("; ")}`);
  }
  // Preserve this host's existing restriction exactly. Erased import-type
  // expressions and import.meta are not runtime imports; agent policy has a
  // different, stricter rule. The parser reports facts for both consumers.
  const imported = file.moduleSyntax.some((item) => ["import-declaration", "import-equals", "module-re-export", "dynamic-import"].includes(item.kind));
  if (imported) {
    throw new SyntaxError(`sandboxed loader ${fileName} may not import modules`);
  }
}

function validateLimits(
  timeoutMs: number,
  memoryMb: number,
  maxOutputBytes: number,
  maxInputBytes: number,
  maxRequests: number,
  maxConcurrentRequests: number,
): void {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new RangeError("sandbox timeoutMs must be between 1 and 300000");
  }
  if (!Number.isSafeInteger(memoryMb) || memoryMb < 16 || memoryMb > 4096) {
    throw new RangeError("sandbox memoryMb must be between 16 and 4096");
  }
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 64 * 1024 * 1024) {
    throw new RangeError("sandbox maxOutputBytes must be between 1024 and 67108864");
  }
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1024 || maxInputBytes > 256 * 1024 * 1024) {
    throw new RangeError("sandbox maxInputBytes must be between 1024 and 268435456");
  }
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 0 || maxRequests > 100_000) {
    throw new RangeError("sandbox maxRequests must be between 0 and 100000");
  }
  if (
    !Number.isSafeInteger(maxConcurrentRequests) || maxConcurrentRequests < 1 ||
    maxConcurrentRequests > Math.max(1, maxRequests)
  ) {
    throw new RangeError("sandbox maxConcurrentRequests must be positive and no greater than maxRequests");
  }
}

/**
 * Everything about the execution sandbox that a comptime result can depend on:
 * the runner bytes, the runtime build, and the environment the child is given.
 * It is folded whole into `implementationDigest`, so two sandboxes that could
 * produce different bytes cannot share one cache key.
 */
export interface SandboxExecutionIdentity {
  readonly runnerDigest: string;
  readonly runtimeVersion: string;
  readonly environment: Readonly<Record<string, string>>;
}

const sandboxIdentityCache = new Map<string, SandboxExecutionIdentity>();

export function sandboxExecutionIdentity(
  denoPath = "deno",
  runnerPath = fileURLToPath(new URL("./loader-runner.js", import.meta.url)),
): SandboxExecutionIdentity {
  const runnerDigest = digest(readFileSync(runnerPath, "utf8"));
  const cacheKey = `${denoPath}\0${runnerDigest}`;
  const cached = sandboxIdentityCache.get(cacheKey);
  if (cached) return cached;
  const probe = spawnSync(denoPath, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 64 * 1024,
  });
  if (probe.error) throw new Error(`could not inspect sandbox runtime '${denoPath}': ${probe.error.message}`);
  if (probe.status !== 0 || !probe.stdout.trim()) {
    throw new Error(`sandbox runtime '${denoPath}' did not report a version`);
  }
  const identity: SandboxExecutionIdentity = Object.freeze({
    runnerDigest,
    runtimeVersion: probe.stdout.trim(),
    environment: SANDBOX_ENVIRONMENT,
  });
  sandboxIdentityCache.set(cacheKey, identity);
  return identity;
}

const inspectSandbox = sandboxExecutionIdentity;

function transpileLoader(source: string, fileName: string): string {
  const output = getNativeCompiler().compile({
    rootNames: ["loader.mts"],
    files: [{ path: "loader.mts", text: source, kind: "typescript" }],
    lowering: "typescript",
    options: {
      target: "ES2022", module: "ESNext", moduleResolution: "bundler",
      strict: true, isolatedModules: true, verbatimModuleSyntax: true,
      // This stage erases a self-contained loader, as transpileModule did. It
      // is not the language checker or a claim that its host API is typed.
      noCheck: true, noEmitOnError: true, types: [],
    },
  });
  const errors = output.diagnostics.filter((diagnostic) => diagnostic.category === "error");
  if (errors.length > 0 || output.emitSkipped) {
    throw new SyntaxError(
      `sandboxed loader ${fileName} did not compile: ` + errors.map((diagnostic) => diagnostic.message).join("; "),
    );
  }
  const artifact = output.artifacts.find((item) => item.path === "loader.mjs");
  if (!artifact) throw new SyntaxError(`sandboxed loader ${fileName} emitted no native module`);
  return Buffer.from(artifact.content, "base64").toString("utf8");
}

interface ExecutionOptions {
  readonly denoPath: string;
  readonly runnerPath: string;
  readonly source: string;
  readonly exportName: string;
  readonly timeoutMs: number;
  readonly memoryMb: number;
  readonly maxOutputBytes: number;
  readonly maxInputBytes: number;
  readonly maxRequests: number;
  readonly maxConcurrentRequests: number;
  readonly invocation:
    | { readonly mode: "loader"; readonly asset: LoaderAsset }
    | { readonly mode: "comptime"; readonly args: ComptimeValueGraph };
  readonly context: LoaderContext;
}

async function executeSandboxedModule(options: ExecutionOptions): Promise<StableJson> {
  const child = spawn(options.denoPath, [
    "run",
    "--quiet",
    "--no-prompt",
    "--no-config",
    "--no-lock",
    "--no-npm",
    `--v8-flags=--max-old-space-size=${options.memoryMb},--disallow-code-generation-from-strings`,
    "--deny-read",
    "--deny-write",
    "--deny-net",
    "--deny-env",
    "--deny-run",
    "--deny-sys",
    "--deny-ffi",
    "--deny-import",
    options.runnerPath,
  ], { stdio: ["pipe", "pipe", "pipe"], env: sandboxEnvironment() });
  const closed = new Promise<[number | null, NodeJS.Signals | null]>((resolveClose) => {
    child.once("close", (code, signal) => resolveClose([code, signal]));
  });

  let terminal: RunnerResult | RunnerError | undefined;
  let stderr = "";
  let outputBytes = 0;
  let inputBytes = 0;
  let protocolError: Error | undefined;
  let timedOut = false;
  child.once("error", (error) => {
    protocolError = error;
  });
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream.on("error", (error) => {
      protocolError ??= error;
      kill();
    });
  }

  const kill = (): void => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  const timer = setTimeout(() => {
    timedOut = true;
    kill();
  }, options.timeoutMs);
  timer.unref();

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    outputBytes += Buffer.byteLength(chunk);
    if (stderr.length < options.maxOutputBytes) stderr += chunk;
    if (outputBytes > options.maxOutputBytes) {
      protocolError = new Error("sandboxed loader exceeded its output limit");
      kill();
    }
  });

  // Enforce the limit on raw chunks. readline only emits after a newline and
  // would otherwise buffer an arbitrarily large terminal message first.
  child.stdout.on("data", (chunk: Buffer) => {
    outputBytes += chunk.byteLength;
    if (outputBytes > options.maxOutputBytes) {
      protocolError = new Error("sandboxed loader exceeded its output limit");
      kill();
    }
  });

  let writeTail = Promise.resolve();
  const write = async (message: unknown): Promise<void> => {
    const line = `${JSON.stringify(message)}\n`;
    inputBytes += Buffer.byteLength(line);
    if (inputBytes > options.maxInputBytes) {
      throw new Error("sandboxed loader exceeded its input transport limit");
    }
    const current = writeTail.then(async () => {
      if (child.stdin.destroyed || !child.stdin.writable) {
        throw new Error("sandboxed loader protocol closed before the response was sent");
      }
      if (!child.stdin.write(line, "utf8")) await once(child.stdin, "drain");
    });
    writeTail = current.catch(() => {});
    await current;
  };

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("error", (error) => {
    protocolError ??= error;
    kill();
  });
  const handling: Promise<void>[] = [];
  const requestIds = new Set<number>();
  let requestCount = 0;
  let activeRequests = 0;
  lines.on("line", (line) => {
    if (protocolError) return;
    let message: RunnerMessage;
    try {
      message = JSON.parse(line) as RunnerMessage;
    } catch {
      protocolError = new Error("sandboxed loader emitted invalid JSON protocol output");
      kill();
      return;
    }
    if (message === null || typeof message !== "object" || typeof message.kind !== "string") {
      protocolError = new Error("sandboxed loader emitted an invalid protocol message");
      kill();
      return;
    }
    if (message.kind === "request") {
      if (
        !Number.isSafeInteger(message.id) || message.id < 0 || requestIds.has(message.id) ||
        ++requestCount > options.maxRequests || activeRequests >= options.maxConcurrentRequests ||
        typeof message.specifier !== "string" || Buffer.byteLength(message.specifier) > 4096
      ) {
        protocolError = new Error("sandboxed loader exceeded or violated its dependency request policy");
        kill();
        return;
      }
      requestIds.add(message.id);
      activeRequests++;
      const task = handleRequest(message, options.context, write)
        .catch((error: unknown) => {
          protocolError = error instanceof Error ? error : new Error(String(error));
          kill();
        })
        .finally(() => { activeRequests--; });
      handling.push(task);
      return;
    }
    if (message.kind === "result" || message.kind === "error") {
      if (terminal) {
        protocolError = new Error("sandboxed loader emitted more than one terminal message");
        kill();
      } else {
        terminal = message;
      }
      return;
    }
    protocolError = new Error("sandboxed loader emitted an unknown protocol message");
    kill();
  });

  const initialization = {
    kind: "init",
    protocol: LOADER_PROTOCOL_VERSION,
    sourceBase64: Buffer.from(options.source, "utf8").toString("base64"),
    exportName: options.exportName,
    invocation: options.invocation.mode === "loader"
      ? {
          mode: "loader",
          asset: {
            path: options.invocation.asset.path,
            bytes: Buffer.from(options.invocation.asset.bytes).toString("base64"),
          },
        }
      : { mode: "comptime", args: options.invocation.args },
    context: {
      target: options.context.target,
      options: stableClone(options.context.options, "sandboxed loader options"),
    },
  };

  try {
    await write(initialization);
    const [exitCode, signal] = await closed;
    await Promise.allSettled(handling);
    if (timedOut) throw new Error(`sandboxed loader timed out after ${options.timeoutMs}ms`);
    if (protocolError) throw protocolError;
    if (!terminal) {
      throw new Error(
        `sandboxed loader exited without a result (code ${String(exitCode)}, signal ${String(signal)})` +
        (stderr.trim() ? `: ${stderr.trim()}` : ""),
      );
    }
    if (terminal.kind === "error") {
      const error = new Error(terminal.message);
      error.name = terminal.name ?? "SandboxedLoaderError";
      if (terminal.stack) error.stack = terminal.stack;
      throw error;
    }
    if (exitCode !== 0) {
      throw new Error(`sandboxed loader exited with code ${String(exitCode)}: ${stderr.trim()}`);
    }
    return options.invocation.mode === "comptime" ? decodeComptimeValue(terminal.value)
      : cloneJsonValue(terminal.value, "sandboxed module result");
  } finally {
    clearTimeout(timer);
    lines.close();
    child.stdin.destroy();
    kill();
    await closed;
  }
}

async function handleRequest(
  request: RunnerRequest,
  context: LoaderContext,
  write: (message: unknown) => Promise<void>,
): Promise<void> {
  if (!Number.isSafeInteger(request.id) || request.id < 0 || typeof request.specifier !== "string") {
    throw new Error("sandboxed loader sent an invalid dependency request");
  }
  try {
    let value: unknown;
    switch (request.method) {
      case "readText":
        value = await context.readText(request.specifier);
        break;
      case "readBytes":
        value = { base64: Buffer.from(await context.readBytes(request.specifier)).toString("base64") };
        break;
      case "import":
        value = await context.import(request.specifier, request.options ?? {});
        break;
      default:
        throw new Error("sandboxed loader requested an unsupported context operation");
    }
    await write({ kind: "response", id: request.id, ok: true, value: cloneJsonValue(value) });
  } catch (error) {
    await write({
      kind: "response",
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error("sandboxed loader dependency request failed", { cause: error });
  }
}
