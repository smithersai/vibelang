import { spawn, spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { once } from "node:events";
import * as ts from "typescript-js";
import type {
  AssetLoader,
  LoaderAsset,
  LoaderContext,
  TypedAssetModule,
} from "./assets.ts";
import { digest, stableClone } from "./stable.ts";
import type { StableJson } from "./stable.ts";

const LOADER_PROTOCOL_VERSION = 1;
const authenticAssetLoaders = new WeakSet<object>();

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
  const { originalSource, executable, source, exportName } = compiled;
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
      compiler: source === executable ? "javascript" : `typescript@${ts.version}`,
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
    compiler: compiled.source === compiled.executable ? "javascript" : `typescript@${ts.version}`,
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
      const clonedArgs = stableClone(args, "comptime arguments") as StableJson[];
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
        invocation: { mode: "comptime", args: clonedArgs },
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
  /** Authored bytes. Always part of the implementation digest. */
  originalSource: string;
  /** Text actually compiled and executed: the lowering when one was supplied. */
  executable: string;
  source: string;
  exportName: string;
} {
  if (typeof modulePathInput !== "string") throw new TypeError("sandboxed module path must be a string");
  const modulePath = realpathSync(modulePathInput);
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
  validateSandboxSource(executable, modulePath);
  const source = /\.(?:cts|mts|ts)$/.test(modulePath)
    ? transpileLoader(executable, modulePath)
    : executable;
  const exportName = exportNameInput;
  if (typeof exportName !== "string") throw new TypeError("sandboxed module export name must be a string");
  if (!/^[$A-Z_a-z][$\w]*$/.test(exportName) && exportName !== "default") {
    throw new TypeError(`invalid module export name '${exportName}'`);
  }
  return { modulePath, originalSource, executable, source, exportName };
}

function validateSandboxSource(source: string, fileName: string): void {
  const scriptKind = /\.[cm]?tsx?$/.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind);
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics.length > 0) {
    throw new SyntaxError(`sandboxed loader ${fileName} did not parse: ${diagnostics
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      .join("; ")}`);
  }
  let imported = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) ||
      (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) imported = true;
    ts.forEachChild(node, visit);
  };
  visit(file);
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

const sandboxIdentityCache = new Map<string, Readonly<{ runnerDigest: string; runtimeVersion: string }>>();

function inspectSandbox(
  denoPath: string,
  runnerPath: string,
): Readonly<{ runnerDigest: string; runtimeVersion: string }> {
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
  const identity = Object.freeze({ runnerDigest, runtimeVersion: probe.stdout.trim() });
  sandboxIdentityCache.set(cacheKey, identity);
  return identity;
}

function transpileLoader(source: string, fileName: string): string {
  const output = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      isolatedModules: true,
      verbatimModuleSyntax: true,
    },
  });
  const errors = (output.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length > 0) {
    throw new SyntaxError(
      `sandboxed loader ${fileName} did not compile: ` +
      errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("; "),
    );
  }
  return output.outputText;
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
    | { readonly mode: "comptime"; readonly args: readonly StableJson[] };
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
  ], { stdio: ["pipe", "pipe", "pipe"] });
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
    return stableClone(terminal.value, "sandboxed module result");
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
    await write({ kind: "response", id: request.id, ok: true, value: stableClone(value) });
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
