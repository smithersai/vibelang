import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fsConstants, realpathSync, type Stats } from "node:fs";
import { access, lstat, mkdir, mkdtemp, open, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { digest } from "./stable.ts";

export type ForeignLanguage = "zig" | "rust";

export interface ForeignFunction {
  name: string;
  parameters: Array<{ name: string; foreignType: string; typeScriptType: "number" | "bigint" }>;
  result: { foreignType: string; typeScriptType: "number" | "bigint" | "void" };
}

export interface ForeignBuild {
  language: ForeignLanguage;
  sourcePath: string;
  compilerVersion: string;
  key: string;
  cacheHit: boolean;
  wasm: Uint8Array;
  functions: ForeignFunction[];
  declaration: string;
  dependencies: Array<{ path: string; digest: string }>;
}

export interface ForeignCompilerOptions {
  cacheDirectory: string;
  zig?: string;
  rustc?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxArtifactBytes?: number;
  maxSourceBytes?: number;
  maxTotalSourceBytes?: number;
  maxSourceFiles?: number;
  maxCacheMetadataBytes?: number;
  maxToolBytes?: number;
  sourceRoot?: string;
  /** The compiler sees only this explicit environment plus a tiny deterministic base. */
  environment?: Readonly<Record<string, string>>;
}

interface ForeignCacheMetadata {
  language: ForeignLanguage;
  compilerVersion: string;
  functions: ForeignFunction[];
  wasmDigest: string;
  inputKey: string;
}

interface PreparedForeignBuild {
  readonly absolute: string;
  readonly sourceRoot: string;
  readonly language: ForeignLanguage;
  readonly tool: ForeignToolIdentity;
  readonly environment: Readonly<Record<string, string>>;
  readonly compilerVersion: string;
  readonly sources: ForeignSourceSnapshot[];
  readonly functions: ForeignFunction[];
  readonly dependencies: Array<{ path: string; digest: string }>;
  readonly key: string;
}

interface ForeignToolIdentity {
  readonly invocationPath: string;
  readonly canonicalPath: string;
  readonly invocationName: string;
  readonly contentDigest: string;
  readonly size: number;
  readonly device: number;
  readonly inode: number;
  readonly modifiedMs: number;
  readonly changedMs: number;
}

interface SourceCollectionBudget {
  readonly maxSourceBytes: number;
  readonly maxTotalSourceBytes: number;
  readonly maxSourceFiles: number;
  totalSourceBytes: number;
  readonly identities: Map<string, string>;
}

const CACHE_METADATA_DEFAULT_BYTES = 512 * 1024;
const MAX_ENVIRONMENT_BYTES = 64 * 1024;
const MAX_FOREIGN_FUNCTIONS = 1_024;

/**
 * Real Zig/Rust -> Wasm execution, with intentionally tiny source-level binding
 * extraction. It proves the tool/build boundary; a production compiler must use
 * compiler metadata rather than this deliberately small dependency scanner.
 */
export class ForeignCompiler {
  readonly cacheDirectory: string;
  readonly zig: string;
  readonly rustc: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly maxArtifactBytes: number;
  readonly maxSourceBytes: number;
  readonly maxTotalSourceBytes: number;
  readonly maxSourceFiles: number;
  readonly maxCacheMetadataBytes: number;
  readonly maxToolBytes: number;
  readonly sourceRoot: string | undefined;
  readonly environment: Readonly<Record<string, string>>;
  readonly #inflight = new Map<string, Promise<ForeignBuild>>();

  constructor(options: ForeignCompilerOptions) {
    this.cacheDirectory = canonicalFuturePath(options.cacheDirectory);
    this.zig = options.zig ?? "zig";
    this.rustc = options.rustc ?? "rustc";
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 4 * 1024 * 1024;
    this.maxArtifactBytes = options.maxArtifactBytes ?? 64 * 1024 * 1024;
    this.maxSourceBytes = options.maxSourceBytes ?? 16 * 1024 * 1024;
    this.maxTotalSourceBytes = options.maxTotalSourceBytes ?? 64 * 1024 * 1024;
    this.maxSourceFiles = options.maxSourceFiles ?? 1_024;
    this.maxCacheMetadataBytes = options.maxCacheMetadataBytes ?? CACHE_METADATA_DEFAULT_BYTES;
    this.maxToolBytes = options.maxToolBytes ?? 512 * 1024 * 1024;
    this.sourceRoot = options.sourceRoot === undefined ? undefined : resolve(options.sourceRoot);
    this.environment = snapshotForeignEnvironment(options.environment);
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30 * 60_000) {
      throw new RangeError("foreign compiler timeoutMs must be between 1 and 1800000");
    }
    if (!Number.isSafeInteger(this.maxOutputBytes) || this.maxOutputBytes < 1024) {
      throw new RangeError("foreign compiler maxOutputBytes must be at least 1024");
    }
    if (!Number.isSafeInteger(this.maxArtifactBytes) || this.maxArtifactBytes < 1024) {
      throw new RangeError("foreign compiler maxArtifactBytes must be at least 1024");
    }
    if (!Number.isSafeInteger(this.maxSourceBytes) || this.maxSourceBytes < 1024) {
      throw new RangeError("foreign compiler maxSourceBytes must be at least 1024");
    }
    if (!Number.isSafeInteger(this.maxTotalSourceBytes) || this.maxTotalSourceBytes < this.maxSourceBytes) {
      throw new RangeError("foreign compiler maxTotalSourceBytes must be at least maxSourceBytes");
    }
    if (!Number.isSafeInteger(this.maxSourceFiles) || this.maxSourceFiles < 1 || this.maxSourceFiles > 10_000) {
      throw new RangeError("foreign compiler maxSourceFiles must be between 1 and 10000");
    }
    if (!Number.isSafeInteger(this.maxCacheMetadataBytes) || this.maxCacheMetadataBytes < 1_024) {
      throw new RangeError("foreign compiler maxCacheMetadataBytes must be at least 1024");
    }
    if (!Number.isSafeInteger(this.maxToolBytes) || this.maxToolBytes < 1_024) {
      throw new RangeError("foreign compiler maxToolBytes must be at least 1024");
    }
  }

  async compile(sourcePath: string, language: ForeignLanguage): Promise<ForeignBuild> {
    if (language !== "zig" && language !== "rust") throw new TypeError(`unsupported foreign language: ${String(language)}`);
    const prepared = await this.#prepare(sourcePath, language);
    const existing = this.#inflight.get(prepared.key);
    if (existing) return cloneForeignBuild(await existing);
    const pending = this.#compile(prepared);
    this.#inflight.set(prepared.key, pending);
    try {
      return cloneForeignBuild(await pending);
    } finally {
      if (this.#inflight.get(prepared.key) === pending) this.#inflight.delete(prepared.key);
    }
  }

  async #prepare(sourcePath: string, language: ForeignLanguage): Promise<PreparedForeignBuild> {
    const requested = resolve(sourcePath);
    const sourceRoot = await canonicalDirectory(this.sourceRoot ?? dirname(requested), "foreign source root");
    const absolute = await realpath(requested);
    assertInsideRoot(sourceRoot, absolute, "foreign source");
    assertOutsideCache(this.cacheDirectory, absolute);
    const sources = await collectForeignSources(absolute, sourceRoot, this.cacheDirectory, language, {
      maxSourceBytes: this.maxSourceBytes,
      maxTotalSourceBytes: this.maxTotalSourceBytes,
      maxSourceFiles: this.maxSourceFiles,
      totalSourceBytes: 0,
      identities: new Map<string, string>(),
    });
    const main = sources.find((entry) => entry.path === absolute);
    if (!main) throw new Error(`foreign source snapshot omitted ${absolute}`);
    const source = decodeSource(main.bytes, absolute);

    const requestedTool = language === "zig" ? this.zig : this.rustc;
    const tool = await identifyForeignTool(requestedTool, this.environment, this.maxToolBytes);
    const versionResult = await run(
      tool.invocationPath,
      language === "zig" ? ["version"] : ["--version", "--verbose"],
      this.timeoutMs,
      this.maxOutputBytes,
      tmpdir(),
      this.environment,
    );
    await verifyForeignTool(tool, this.maxToolBytes);
    const compilerVersion = versionResult.stdout.trim();
    if (compilerVersion.length === 0) throw new Error(`${tool.invocationPath} returned an empty compiler version`);
    const keyedSources = sources.map((entry) => ({
      path: relative(sourceRoot, entry.path).split(sep).join("/"),
      digest: sourceDigest(entry.bytes),
    }));
    const dependencies = sources
      .filter((entry) => entry.path !== absolute)
      .map((entry) => ({
        path: relative(sourceRoot, entry.path).split(sep).join("/"),
        digest: sourceDigest(entry.bytes),
      }));
    const functions = language === "zig" ? parseZigFunctions(source) : parseRustFunctions(source);
    if (functions.length === 0) throw new Error(`${basename(absolute)} exports no supported C/Wasm functions`);
    if (functions.length > MAX_FOREIGN_FUNCTIONS) {
      throw new Error(`${basename(absolute)} exceeds ${MAX_FOREIGN_FUNCTIONS} supported foreign exports`);
    }
    const key = digest({
      rule: "smithers:foreign-wasm@4",
      language,
      compilerVersion,
      compilerVersionEvidence: digest({ stdout: versionResult.stdout, stderr: versionResult.stderr }),
      tool: {
        canonicalPath: tool.canonicalPath,
        invocationName: tool.invocationName,
        contentDigest: tool.contentDigest,
        size: tool.size,
      },
      environment: this.environment,
      sources: keyedSources,
      build: language === "zig"
        ? { target: "wasm32-freestanding", optimize: "ReleaseSmall", entry: false, dynamicExports: true }
        : { target: "wasm32-unknown-unknown", optimize: true, crateType: "cdylib", remapSourceRoot: true },
      host: { platform: process.platform, architecture: process.arch },
    });
    return { absolute, sourceRoot, language, tool, environment: this.environment, compilerVersion, sources, functions, dependencies, key };
  }

  async #compile(prepared: PreparedForeignBuild): Promise<ForeignBuild> {
    const { absolute, sourceRoot, language, tool, environment, compilerVersion, sources, functions, dependencies, key } = prepared;
    const wasmPath = join(this.cacheDirectory, `${key}.wasm`);
    const metadataPath = join(this.cacheDirectory, `${key}.json`);
    try {
      const wasm = await readBytesBounded(wasmPath, this.maxArtifactBytes, "cached foreign Wasm artifact");
      const metadata = JSON.parse(
        await readTextBounded(metadataPath, this.maxCacheMetadataBytes, "foreign cache metadata"),
      ) as ForeignCacheMetadata;
        if (
          metadata.language === language && metadata.compilerVersion === compilerVersion &&
          metadata.inputKey === key && digest(metadata.functions) === digest(functions) &&
          metadata.wasmDigest === wasmDigest(wasm)
        ) {
          validateWasmExports(wasm, functions);
          return {
            language, sourcePath: absolute, compilerVersion, key, cacheHit: true,
            wasm, functions, declaration: declarationFor(functions), dependencies,
          };
        }
    } catch {
      // Corrupt, symlinked, oversized, or incompatible cache objects are ordinary misses.
    }

    const temporaryDirectory = await mkdtemp(join(tmpdir(), "smithers-foreign-"));
    const temporaryWasm = join(temporaryDirectory, "module.wasm");
    try {
      const snapshotRoot = join(temporaryDirectory, "sources");
      for (const entry of sources) {
        const snapshotPath = join(snapshotRoot, relative(sourceRoot, entry.path));
        await mkdir(dirname(snapshotPath), { recursive: true });
        await writeFile(snapshotPath, entry.bytes);
      }
      const snapshotEntry = join(snapshotRoot, relative(sourceRoot, absolute));
      const snapshotSpecifier = relative(snapshotRoot, snapshotEntry);
      const args = language === "zig"
        ? [
            "build-exe", snapshotSpecifier, "-target", "wasm32-freestanding", "-fno-entry", "-rdynamic",
            "-O", "ReleaseSmall", "--cache-dir", join(temporaryDirectory, "zig-cache"),
            "--global-cache-dir", join(temporaryDirectory, "zig-global-cache"), `-femit-bin=${temporaryWasm}`,
          ]
        : [
            "--crate-type=cdylib", "--target", "wasm32-unknown-unknown", "-O",
            `--remap-path-prefix=${snapshotRoot}=.`, snapshotSpecifier, "-o", temporaryWasm,
          ];
      await run(tool.invocationPath, args, this.timeoutMs, this.maxOutputBytes, snapshotRoot, environment);
      await verifyForeignTool(tool, this.maxToolBytes);
      const wasm = await readBytesBounded(temporaryWasm, this.maxArtifactBytes, "foreign compiler artifact");
      validateWasmExports(wasm, functions);
      await ensureCacheDirectory(this.cacheDirectory);
      const encodedMetadata = `${JSON.stringify({
        language,
        compilerVersion,
        functions,
        wasmDigest: wasmDigest(wasm),
        inputKey: key,
      } satisfies ForeignCacheMetadata, null, 2)}\n`;
      if (Buffer.byteLength(encodedMetadata) <= this.maxCacheMetadataBytes) {
        await writeAtomic(wasmPath, wasm);
        // Metadata is the commit marker and must be published after the object.
        await writeAtomic(metadataPath, encodedMetadata);
      }
      return { language, sourcePath: absolute, compilerVersion, key, cacheHit: false, wasm, functions, declaration: declarationFor(functions), dependencies };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

function wasmDigest(wasm: Uint8Array): string {
  return digest(Buffer.from(wasm).toString("base64"));
}

function validateWasmExports(wasm: Uint8Array, functions: readonly ForeignFunction[]): void {
  const actualExports = WebAssembly.Module.exports(new WebAssembly.Module(Uint8Array.from(wasm)))
    .filter((entry) => entry.kind === "function")
    .map((entry) => entry.name);
  for (const fn of functions) {
    if (!actualExports.includes(fn.name)) {
      throw new Error(`compiler did not export ${fn.name}; actual: ${actualExports.join(", ")}`);
    }
  }
}

interface ForeignSourceSnapshot {
  readonly path: string;
  readonly bytes: Uint8Array;
}

async function collectForeignSources(
  entry: string,
  sourceRoot: string,
  cacheDirectory: string,
  language: ForeignLanguage,
  budget: SourceCollectionBudget,
): Promise<ForeignSourceSnapshot[]> {
  const entries = new Map<string, ForeignSourceSnapshot>();
  const scanned = new Set<string>();

  const visit = async (path: string, scanAsSource: boolean): Promise<void> => {
    const absolute = await realpath(resolve(path));
    assertInsideRoot(sourceRoot, absolute, "foreign dependency");
    assertOutsideCache(cacheDirectory, absolute);
    let snapshot = entries.get(absolute);
    if (!snapshot) {
      if (entries.size >= budget.maxSourceFiles) {
        throw new Error(`foreign source graph exceeds ${budget.maxSourceFiles} files at ${absolute}`);
      }
      snapshot = await snapshotForeignSource(absolute, budget);
      entries.set(absolute, snapshot);
    }
    if (!scanAsSource || scanned.has(absolute)) return;
    scanned.add(absolute);
    const source = decodeSource(snapshot.bytes, absolute);
    const children = new Map<string, boolean>();
    const add = (specifier: string, childIsSource: boolean): void => {
      if (isAbsolute(specifier)) throw new Error(`absolute foreign dependency is not hermetic: ${specifier}`);
      const child = resolve(dirname(absolute), specifier);
      children.set(child, (children.get(child) ?? false) || childIsSource);
    };
    if (language === "zig") {
      for (const match of source.matchAll(/@import\(\s*["']([^"']+)["']\s*\)/g)) {
        const specifier = match[1]!;
        if (specifier.endsWith(".zig")) add(specifier, true);
        else if (!new Set(["std", "builtin", "root"]).has(specifier)) {
          throw new Error(`untracked Zig package import is outside the bounded foreign graph: ${specifier}`);
        }
      }
      if (/@import\(\s*(?!["'])/.test(source)) {
        throw new Error("computed Zig @import is outside the bounded foreign graph");
      }
      for (const match of source.matchAll(/@embedFile\(\s*["']([^"']+)["']\s*\)/g)) add(match[1]!, false);
      if (/@embedFile\(\s*(?!["'])/.test(source)) {
        throw new Error("computed Zig @embedFile is outside the bounded foreign graph");
      }
      if (/@cImport\s*\(/.test(source)) {
        throw new Error("Zig @cImport is outside the bounded foreign graph");
      }
    } else {
      const explicitlyPathed = new Set<string>();
      for (const match of source.matchAll(/#\s*\[\s*path\s*=\s*["']([^"']+)["']\s*\]\s*(?:pub\s+)?mod\s+([A-Za-z_]\w*)\s*;/g)) {
        explicitlyPathed.add(match[2]!);
        add(match[1]!, true);
      }
      for (const match of source.matchAll(/(?:^|\n)\s*(?:pub\s+)?mod\s+([A-Za-z_]\w*)\s*;/g)) {
        if (explicitlyPathed.has(match[1]!)) continue;
        const flat = resolve(dirname(absolute), `${match[1]}.rs`);
        const nested = resolve(dirname(absolute), match[1]!, "mod.rs");
        children.set(await exists(flat) ? flat : nested, true);
      }
      for (const match of source.matchAll(/(include|include_str|include_bytes)!\(\s*["']([^"']+)["']\s*\)/g)) {
        add(match[2]!, match[1] === "include");
      }
      if (/\b(?:include|include_str|include_bytes)!\(\s*(?!["'])/.test(source)) {
        throw new Error("computed Rust include is outside the bounded foreign graph");
      }
    }
    for (const [child, childIsSource] of [...children].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
      await visit(child, childIsSource);
    }
  };

  await visit(entry, true);
  return [...entries.values()].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

async function snapshotForeignSource(path: string, budget: SourceCollectionBudget): Promise<ForeignSourceSnapshot> {
  const handle = await open(path, fsConstants.O_RDONLY | noFollowFlag());
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > budget.maxSourceBytes) {
      throw new Error(`foreign dependency must be a regular file no larger than ${budget.maxSourceBytes} bytes: ${path}`);
    }
    const identity = `${String(before.dev)}:${String(before.ino)}`;
    if (before.ino !== 0) {
      const owner = budget.identities.get(identity);
      if (owner !== undefined && owner !== path) {
        throw new Error(`foreign source graph aliases one file through hard links: ${owner} and ${path}`);
      }
      budget.identities.set(identity, path);
    }
    const bytes = new Uint8Array(await handle.readFile());
    const after = await handle.stat();
    if (!sameFileState(before, after)) throw new Error(`foreign dependency changed while it was read: ${path}`);
    if (bytes.byteLength > budget.maxSourceBytes || budget.totalSourceBytes + bytes.byteLength > budget.maxTotalSourceBytes) {
      throw new Error(`foreign source graph exceeds its configured byte limits at ${path}`);
    }
    const currentPath = await realpath(path);
    const current = await stat(currentPath);
    if (currentPath !== path || !sameFileState(after, current)) {
      throw new Error(`foreign dependency path changed while it was read: ${path}`);
    }
    budget.totalSourceBytes += bytes.byteLength;
    return { path, bytes };
  } finally {
    await handle.close();
  }
}

function sourceDigest(bytes: Uint8Array): string {
  return digest(Buffer.from(bytes).toString("base64"));
}

function decodeSource(bytes: Uint8Array, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SyntaxError(`${path} is not valid UTF-8 source text`);
  }
}

export async function instantiateForeign(build: ForeignBuild): Promise<Record<string, (...args: never[]) => unknown>> {
  const result = await WebAssembly.instantiate(build.wasm, {});
  const instance = "instance" in result ? result.instance : result;
  return instance.exports as unknown as Record<string, (...args: never[]) => unknown>;
}

function parseZigFunctions(source: string): ForeignFunction[] {
  const output: ForeignFunction[] = [];
  for (const match of source.matchAll(/\bexport\s+fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*([A-Za-z_]\w*)\s*\{/g)) {
    output.push({ name: match[1], parameters: parseParameters(match[2], ":"), result: foreignResult(match[3]) });
  }
  return output;
}

function parseRustFunctions(source: string): ForeignFunction[] {
  const output: ForeignFunction[] = [];
  for (const match of source.matchAll(/\bpub\s+extern\s+"C"\s+fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:->\s*([A-Za-z_]\w*))?/g)) {
    output.push({ name: match[1], parameters: parseParameters(match[2], ":"), result: foreignResult(match[3] ?? "void") });
  }
  return output;
}

function parseParameters(source: string, separator: string): ForeignFunction["parameters"] {
  if (!source.trim()) return [];
  return source.split(",").map((parameter) => {
    const [name, rawType] = parameter.split(separator).map((part) => part.trim());
    if (!name || !rawType) throw new Error(`unsupported foreign parameter: ${parameter}`);
    const result = foreignResult(rawType);
    if (result.typeScriptType === "void") throw new Error(`void parameter: ${parameter}`);
    return { name, foreignType: rawType, typeScriptType: result.typeScriptType };
  });
}

function foreignResult(type: string): ForeignFunction["result"] {
  if (type === "void" || type === "()") return { foreignType: type, typeScriptType: "void" };
  if (["i64", "u64"].includes(type)) return { foreignType: type, typeScriptType: "bigint" };
  // Both POC foreign targets are wasm32, so pointer-sized integers are i32.
  if (["i8", "u8", "i16", "u16", "i32", "u32", "isize", "usize", "f32", "f64"].includes(type)) {
    return { foreignType: type, typeScriptType: "number" };
  }
  throw new Error(`foreign type '${type}' needs an explicit ABI codec`);
}

function declarationFor(functions: readonly ForeignFunction[]): string {
  return functions.map((fn) =>
    `export declare function ${fn.name}(${fn.parameters.map((parameter) => `${parameter.name}: ${parameter.typeScriptType}`).join(", ")}): ${fn.result.typeScriptType};`,
  ).join("\n") + "\n";
}

function cloneForeignBuild(build: ForeignBuild): ForeignBuild {
  return {
    ...build,
    wasm: Uint8Array.from(build.wasm),
    functions: build.functions.map((fn) => ({
      name: fn.name,
      parameters: fn.parameters.map((parameter) => ({ ...parameter })),
      result: { ...fn.result },
    })),
    dependencies: build.dependencies.map((dependency) => ({ ...dependency })),
  };
}

function snapshotForeignEnvironment(explicit: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> {
  if (explicit !== undefined) {
    const prototype = Object.getPrototypeOf(explicit);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("foreign compiler environment must be a plain object");
    }
  }
  const output = Object.create(null) as Record<string, string>;
  output.PATH = process.env.PATH ?? (process.platform === "win32" ? "" : "/usr/local/bin:/usr/bin:/bin");
  output.LANG = "C";
  output.LC_ALL = "C";
  output.TZ = "UTC";
  output.SOURCE_DATE_EPOCH = "1";
  if (process.platform === "win32") {
    for (const key of ["SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP"] as const) {
      const value = process.env[key];
      if (value !== undefined) output[key] = value;
    }
  }
  if (explicit !== undefined) {
    for (const key of Reflect.ownKeys(explicit).sort((left, right) => String(left) < String(right) ? -1 : 1)) {
      if (typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new TypeError(`invalid foreign compiler environment name: ${String(key)}`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(explicit, key);
      if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor) || typeof descriptor.value !== "string") {
        throw new TypeError(`foreign compiler environment ${key} must be an enumerable string data property`);
      }
      output[key] = descriptor.value;
    }
  }
  let bytes = 0;
  for (const [key, value] of Object.entries(output)) {
    if (key.includes("\0") || value.includes("\0")) throw new TypeError(`foreign compiler environment ${key} contains NUL`);
    bytes += Buffer.byteLength(key) + Buffer.byteLength(value) + 2;
  }
  if (bytes > MAX_ENVIRONMENT_BYTES) {
    throw new RangeError(`foreign compiler environment exceeds ${MAX_ENVIRONMENT_BYTES} bytes`);
  }
  return Object.freeze(output);
}

function canonicalFuturePath(input: string): string {
  let cursor = resolve(input);
  const suffix: string[] = [];
  while (true) {
    try {
      const canonical = realpathSync(cursor);
      return resolve(canonical, ...suffix);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      suffix.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

async function canonicalDirectory(path: string, label: string): Promise<string> {
  const canonical = await realpath(path);
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) throw new Error(`${label} must be a directory: ${canonical}`);
  return canonical;
}

function assertInsideRoot(root: string, path: string, label: string): void {
  const back = relative(root, path);
  if (back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) {
    throw new Error(`${label} escapes configured source root ${root}: ${path}`);
  }
}

function assertOutsideCache(cacheDirectory: string, path: string): void {
  const back = relative(cacheDirectory, path);
  if (back === "" || (back !== ".." && !back.startsWith(`..${sep}`) && !isAbsolute(back))) {
    throw new Error(`foreign source graph cannot read compiler cache path: ${path}`);
  }
}

function sameFileState(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function noFollowFlag(): number {
  return typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
}

async function identifyForeignTool(
  command: string,
  environment: Readonly<Record<string, string>>,
  maximumBytes: number,
): Promise<ForeignToolIdentity> {
  const invocationPath = await resolveForeignTool(command, environment);
  const canonicalPath = await realpath(invocationPath);
  const snapshot = await hashRegularFile(canonicalPath, maximumBytes, "foreign compiler executable");
  return {
    invocationPath,
    canonicalPath,
    invocationName: basename(invocationPath),
    contentDigest: snapshot.contentDigest,
    size: snapshot.metadata.size,
    device: snapshot.metadata.dev,
    inode: snapshot.metadata.ino,
    modifiedMs: snapshot.metadata.mtimeMs,
    changedMs: snapshot.metadata.ctimeMs,
  };
}

async function resolveForeignTool(command: string, environment: Readonly<Record<string, string>>): Promise<string> {
  if (command.length === 0 || command.includes("\0")) throw new TypeError("foreign compiler command must be nonempty and contain no NUL");
  const containsSeparator = command.includes("/") || command.includes("\\");
  const candidates: string[] = [];
  if (isAbsolute(command) || containsSeparator) {
    candidates.push(resolve(command));
  } else {
    const extensions = process.platform === "win32" && extname(command) === ""
      ? (environment.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
    for (const part of (environment.PATH ?? "").split(delimiter)) {
      for (const extension of extensions) candidates.push(resolve(part || ".", `${command}${extension}`));
    }
  }
  for (const candidate of candidates) {
    try {
      await access(candidate, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
      return candidate;
    } catch {
      // Keep searching the explicit PATH snapshot.
    }
  }
  throw new Error(`foreign compiler executable was not found: ${command}`);
}

async function verifyForeignTool(tool: ForeignToolIdentity, maximumBytes: number): Promise<void> {
  const currentCanonical = await realpath(tool.invocationPath);
  if (currentCanonical !== tool.canonicalPath) throw new Error(`foreign compiler path changed during build: ${tool.invocationPath}`);
  const snapshot = await hashRegularFile(currentCanonical, maximumBytes, "foreign compiler executable");
  if (
    snapshot.contentDigest !== tool.contentDigest || snapshot.metadata.size !== tool.size ||
    snapshot.metadata.dev !== tool.device || snapshot.metadata.ino !== tool.inode ||
    snapshot.metadata.mtimeMs !== tool.modifiedMs || snapshot.metadata.ctimeMs !== tool.changedMs
  ) {
    throw new Error(`foreign compiler changed during build: ${tool.invocationPath}`);
  }
}

async function hashRegularFile(
  path: string,
  maximumBytes: number,
  label: string,
): Promise<{ contentDigest: string; metadata: Stats }> {
  const handle = await open(path, fsConstants.O_RDONLY | noFollowFlag());
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximumBytes) throw new Error(`${label} exceeds ${maximumBytes} bytes: ${path}`);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < before.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.byteLength, before.size - offset), offset);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset !== before.size || !sameFileState(before, after)) throw new Error(`${label} changed while it was hashed: ${path}`);
    return { contentDigest: hash.digest("hex"), metadata: after };
  } finally {
    await handle.close();
  }
}

async function ensureCacheDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  const canonical = await realpath(path);
  const metadata = await lstat(path);
  if (canonical !== path || !metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`foreign cache directory must be a canonical real directory: ${path}`);
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function run(
  command: string,
  args: string[],
  timeoutMs: number,
  maxOutputBytes: number,
  cwd?: string,
  environment?: Readonly<Record<string, string>>,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: grouped,
      cwd,
      env: environment as NodeJS.ProcessEnv | undefined,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let terminalError: Error | undefined;
    let timedOut = false;
    let settled = false;
    const settleReject = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const settleResolve = (value: { stdout: string; stderr: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(value);
    };
    const kill = (): void => {
      if (grouped && child.pid !== undefined) {
        try { process.kill(-child.pid, "SIGKILL"); return; } catch { /* fall through */ }
      }
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    };
    const collect = (target: Buffer[], chunk: Buffer): void => {
      if (terminalError) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        terminalError = new Error(`${command} exceeded ${maxOutputBytes} output bytes`);
        kill();
        return;
      }
      target.push(Buffer.from(chunk));
    };
    child.stdout?.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr?.on("data", (chunk: Buffer) => collect(stderr, chunk));
    const failStream = (error: Error): void => {
      terminalError ??= error;
      kill();
    };
    child.stdout?.once("error", failStream);
    child.stderr?.once("error", failStream);
    child.once("error", (error: Error) => {
      failStream(error);
      // A command that never spawned emits no close event; the promise must
      // still settle. When close does follow, its callbacks are no-ops.
      if (child.pid === undefined) settleReject(terminalError ?? error);
    });
    const timer = setTimeout(() => {
      if (!terminalError) timedOut = true;
      kill();
    }, timeoutMs);
    timer.unref();
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      // A successful compiler must not leave helpers running either. The
      // compiler process owns a dedicated POSIX process group.
      if (grouped && child.pid !== undefined) {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* group is already gone */ }
      }
      if (timedOut) {
        settleReject(new Error(`${command} timed out after ${timeoutMs}ms`));
        return;
      }
      if (terminalError) {
        settleReject(terminalError);
        return;
      }
      let stdoutText: string;
      let stderrText: string;
      try {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        stdoutText = decoder.decode(Buffer.concat(stdout));
        stderrText = decoder.decode(Buffer.concat(stderr));
      } catch {
        settleReject(new Error(`${command} emitted invalid UTF-8 diagnostics`));
        return;
      }
      if (code !== 0) {
        settleReject(new Error(
          `${command} ${args.join(" ")} failed (code ${String(code)}, signal ${String(signal)})` +
          (stderrText ? `\n${stderrText}` : ""),
        ));
        return;
      }
      settleResolve({ stdout: stdoutText, stderr: stderrText });
    });
  });
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readBytesBounded(path: string, maximum: number, label: string): Promise<Uint8Array> {
  const handle = await open(path, fsConstants.O_RDONLY | noFollowFlag());
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum) {
      throw new Error(`${label} exceeds ${maximum} bytes`);
    }
    const bytes = new Uint8Array(await handle.readFile());
    const after = await handle.stat();
    if (bytes.byteLength > maximum) throw new Error(`${label} exceeds ${maximum} bytes`);
    if (!sameFileState(before, after)) throw new Error(`${label} changed while it was read`);
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readTextBounded(path: string, maximum: number, label: string): Promise<string> {
  const bytes = await readBytesBounded(path, maximum, label);
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
