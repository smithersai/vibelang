import { lstatSync, realpathSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import * as ts from "typescript-js";
import { assertSandboxedLoader } from "./sandboxed-loader.ts";
import { canonical, compareStableStrings, digest, freezeStable, stableClone, type StableJson } from "./stable.ts";

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_CACHED_DEPENDENCIES = 10_000;
const DEFAULT_MAX_ASSET_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_ASSET_GRAPH_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_ASSET_GRAPH_FILES = 1_024;
const DEFAULT_MAX_ASSET_CACHE_ENTRY_BYTES = 64 * 1024 * 1024;

interface AssetGraphSnapshot {
  readonly files: Map<string, Uint8Array>;
  readonly inflight: Map<string, Promise<Uint8Array>>;
  readonly identityOwners: Map<string, string>;
  totalBytes: number;
}

export interface AssetDiagnostic {
  level: "warning" | "error";
  message: string;
  offset?: number;
}

export interface SpanMapping {
  generatedOffset: number;
  sourceOffset: number;
}

/** A deliberately backend-neutral approximation of a checked module. */
export interface TypedAssetModule {
  format: string;
  value: unknown;
  emittedTypeScript: string;
  declaration: string;
  diagnostics: AssetDiagnostic[];
  spans: SpanMapping[];
}

export interface AssetDependency {
  readonly path: string;
  readonly digest: string;
  readonly kind: "file" | "asset";
  readonly access?: "text" | "bytes";
  readonly logicalKey?: string;
  /**
   * Import attributes a loader used for a tracked `kind: "asset"` edge. The
   * edge is self-describing so a later phase can rebuild exactly that child
   * without re-running the parent loader. Absent on `kind: "file"` edges.
   */
  readonly options?: Readonly<Record<string, unknown>>;
}

export interface AssetBuild {
  readonly path: string;
  readonly logicalKey: string;
  readonly key: string;
  readonly loader: string;
  readonly cacheHit: boolean;
  readonly dependencies: readonly AssetDependency[];
  readonly module: TypedAssetModule;
}

export interface LoaderAsset {
  path: string;
  bytes: Uint8Array;
  text(): string;
}

export interface LoaderContext {
  readonly target: string;
  readonly options: Readonly<Record<string, unknown>>;
  readText(specifier: string): Promise<string>;
  readBytes(specifier: string): Promise<Uint8Array>;
  import(specifier: string, options?: Record<string, unknown>): Promise<Omit<AssetBuild, "cacheHit">>;
}

export interface AssetLoader {
  /** Stable package-qualified identity. Never use Function#toString as an identity. */
  id: string;
  version: string;
  /** Digest of the loader artifact together with its locked dependencies. */
  implementationDigest: string;
  extensions: readonly string[];
  /** Import-attribute `type` selectors owned by this loader. */
  types?: readonly string[];
  load(asset: LoaderAsset, context: LoaderContext): Promise<TypedAssetModule> | TypedAssetModule;
}

interface CacheIndexEntry {
  sourceDigest: string;
  dependencies: readonly AssetDependency[];
  key: string;
}

interface CacheEnvelope {
  build: Omit<AssetBuild, "cacheHit">;
  outputDigest: string;
}

export interface AssetCompilerOptions {
  root: string;
  cacheDirectory: string;
  target?: string;
  options?: Record<string, unknown>;
  /** Maximum bytes read from any one source or declared dependency. */
  maximumFileBytes?: number;
  /** Maximum unique source/dependency bytes snapshotted by one top-level build. */
  maximumGraphBytes?: number;
  /** Maximum unique source/dependency files snapshotted by one top-level build. */
  maximumGraphFiles?: number;
  /** Maximum JSON bytes accepted from one compiler-owned cache entry. */
  maximumCacheEntryBytes?: number;
  /** @internal Test/migration seam. Production custom loaders must be sandboxed. */
  unsafeAllowInProcessLoadersForTests?: boolean;
}

export class AssetCompiler {
  readonly root: string;
  readonly cacheDirectory: string;
  readonly target: string;
  readonly options: Readonly<Record<string, unknown>>;
  readonly maximumFileBytes: number;
  readonly maximumGraphBytes: number;
  readonly maximumGraphFiles: number;
  readonly maximumCacheEntryBytes: number;
  readonly #loaders = new Map<string, AssetLoader>();
  readonly #loadersByType = new Map<string, AssetLoader>();
  /** Types owned by compiler-owned built-ins, which always win precedence. */
  readonly #builtinTypes = new Set<string>();
  readonly #topLevelInflight = new Map<string, Promise<AssetBuild>>();
  readonly #unsafeAllowInProcessLoaders: boolean;

  constructor(options: AssetCompilerOptions) {
    this.root = realpathSync(resolve(options.root));
    if (!statSync(this.root).isDirectory()) throw new Error("asset compiler root must be a directory");
    // Keep the authority boundary in the same canonical namespace as source
    // paths. On macOS, for example, a temporary path can lexically begin in
    // /var while realpath reports /private/var; comparing those forms would
    // accidentally let a loader read compiler-owned cache files.
    this.cacheDirectory = canonicalFuturePath(options.cacheDirectory);
    this.target = options.target ?? "typescript-node";
    this.maximumFileBytes = positiveLimit(
      options.maximumFileBytes,
      DEFAULT_MAX_ASSET_FILE_BYTES,
      "maximumFileBytes",
    );
    this.maximumGraphBytes = positiveLimit(
      options.maximumGraphBytes,
      DEFAULT_MAX_ASSET_GRAPH_BYTES,
      "maximumGraphBytes",
    );
    this.maximumGraphFiles = positiveLimit(
      options.maximumGraphFiles,
      DEFAULT_MAX_ASSET_GRAPH_FILES,
      "maximumGraphFiles",
    );
    this.maximumCacheEntryBytes = positiveLimit(
      options.maximumCacheEntryBytes,
      DEFAULT_MAX_ASSET_CACHE_ENTRY_BYTES,
      "maximumCacheEntryBytes",
    );
    if (this.maximumGraphBytes < this.maximumFileBytes) {
      throw new RangeError("maximumGraphBytes must be at least maximumFileBytes");
    }
    if (this.maximumGraphFiles > MAX_CACHED_DEPENDENCIES) {
      throw new RangeError(`maximumGraphFiles cannot exceed ${MAX_CACHED_DEPENDENCIES}`);
    }
    if (options.unsafeAllowInProcessLoadersForTests !== undefined &&
      typeof options.unsafeAllowInProcessLoadersForTests !== "boolean") {
      throw new TypeError("unsafeAllowInProcessLoadersForTests must be boolean when provided");
    }
    this.#unsafeAllowInProcessLoaders = options.unsafeAllowInProcessLoadersForTests === true;
    const globalOptions = stableClone(options.options ?? {}, "asset compiler options");
    if (globalOptions === null || Array.isArray(globalOptions) || typeof globalOptions !== "object") {
      throw new TypeError("asset compiler options must be a JSON object");
    }
    this.options = freezeStable(globalOptions) as Readonly<Record<string, unknown>>;
    this.#register([jsonLoader, textLoader, bytesLoader, markdownLoader, mdxLoader], true);
  }

  register(...loaders: AssetLoader[]): this {
    return this.#register(loaders, false);
  }

  #register(loaders: readonly AssetLoader[], compilerOwned: boolean): this {
    const nextExtensions = new Map(this.#loaders);
    const nextTypes = new Map(this.#loadersByType);
    for (const loader of loaders) {
      if (!compilerOwned && !this.#unsafeAllowInProcessLoaders) assertSandboxedLoader(loader);
      if (
        typeof loader?.id !== "string" || typeof loader.version !== "string" ||
        typeof loader.implementationDigest !== "string" || !Array.isArray(loader.extensions)
      ) throw new TypeError("loader registration has an invalid identity or extension list");
      const snapshot: AssetLoader = Object.freeze({
        id: loader.id,
        version: loader.version,
        implementationDigest: loader.implementationDigest,
        extensions: Object.freeze([...loader.extensions]),
        types: loader.types ? Object.freeze([...loader.types]) : undefined,
        load: loader.load,
      });
      if (!snapshot.id.trim() || !snapshot.version.trim()) {
        throw new Error("loader id and version must be non-empty");
      }
      if (!snapshot.implementationDigest.trim()) {
        throw new Error(`loader ${loader.id} must pin an implementation digest`);
      }
      if (typeof snapshot.load !== "function") throw new TypeError(`loader ${snapshot.id} must provide load()`);
      for (const extension of snapshot.extensions) {
        if (!extension.startsWith(".")) throw new Error(`loader extension must start with '.': ${extension}`);
        const existing = nextExtensions.get(extension);
        if (existing) throw new Error(`loader conflict for ${extension}: ${existing.id} and ${snapshot.id}`);
        nextExtensions.set(extension, snapshot);
      }
      for (const type of snapshot.types ?? []) {
        if (!/^[a-z][a-z0-9-]*$/.test(type)) throw new Error(`loader type must be a lowercase identifier: ${type}`);
        const existing = nextTypes.get(type);
        if (existing) throw new Error(`loader conflict for type '${type}': ${existing.id} and ${snapshot.id}`);
        nextTypes.set(type, snapshot);
        if (compilerOwned) this.#builtinTypes.add(type);
      }
    }
    this.#loaders.clear();
    this.#loadersByType.clear();
    for (const [extension, loader] of nextExtensions) this.#loaders.set(extension, loader);
    for (const [type, loader] of nextTypes) this.#loadersByType.set(type, loader);
    return this;
  }

  /**
   * Identity of the loader currently selected for an import-attribute `type`.
   * The source-asset preflight uses this to apply loader precedence: a
   * compiler-owned built-in always wins over a project registration. It never
   * exposes the loader's `load` implementation.
   */
  describeTypeLoader(
    type: string,
  ): Readonly<{ id: string; version: string; implementationDigest: string; builtin: boolean }> | undefined {
    if (typeof type !== "string") throw new TypeError("asset import attribute 'type' must be a string");
    const loader = this.#loadersByType.get(type);
    if (!loader) return undefined;
    return Object.freeze({
      id: loader.id,
      version: loader.version,
      implementationDigest: loader.implementationDigest,
      builtin: this.#builtinTypes.has(type),
    });
  }

  async compile(specifier: string, localOptions: Record<string, unknown> = {}): Promise<AssetBuild> {
    const optionSnapshot = snapshotOptions(localOptions, "asset import options");
    const path = this.#resolveInsideRoot(specifier, this.root);
    const requestKey = digest({ path: relative(this.root, path), options: optionSnapshot, target: this.target });
    const existing = this.#topLevelInflight.get(requestKey);
    if (existing) return existing;
    const pending = this.#compilePath(path, optionSnapshot, [], {
      files: new Map(),
      inflight: new Map(),
      identityOwners: new Map(),
      totalBytes: 0,
    });
    this.#topLevelInflight.set(requestKey, pending);
    try {
      return await pending;
    } finally {
      if (this.#topLevelInflight.get(requestKey) === pending) this.#topLevelInflight.delete(requestKey);
    }
  }

  /** Validate a previously recorded child edge without re-running its loader. */
  async isDependencyCurrent(dependency: AssetDependency): Promise<boolean> {
    return await dependenciesStillMatch(
      [dependency],
      this.root,
      this.cacheDirectory,
      new Set(),
      dependencyCheckBudget(this),
    );
  }

  async #compilePath(
    path: string,
    localOptions: Readonly<Record<string, unknown>>,
    stack: readonly string[],
    graph: AssetGraphSnapshot,
  ): Promise<AssetBuild> {
    // Snapshot before the first await so caller mutation cannot change output
    // under an already-computed logical/content key.
    const optionSnapshot = snapshotOptions(localOptions, "asset import options");
    if (stack.includes(path)) throw new Error(`asset cycle: ${[...stack, path].map((x) => relative(this.root, x)).join(" -> ")}`);
    const selectedType = optionSnapshot.type;
    if (selectedType !== undefined && typeof selectedType !== "string") {
      throw new TypeError("asset import attribute 'type' must be a string");
    }
    const loader = selectedType === undefined
      ? this.#loaders.get(extname(path))
      : this.#loadersByType.get(selectedType);
    if (!loader) {
      throw new Error(selectedType === undefined
        ? `no comptime loader registered for ${extname(path) || path}`
        : `no comptime loader registered for import type '${selectedType}'`);
    }

    const bytes = await this.#snapshotFile(path, graph);
    const sourceDigest = digest(bytesToStableString(bytes));
    const identity = {
      compiler: "smithers-assets@4",
      loader: loader.id,
      loaderVersion: loader.version,
      loaderImplementation: loader.implementationDigest,
      target: this.target,
      options: this.options,
      localOptions: optionSnapshot,
      path: portableRelative(this.root, path),
      limits: {
        maximumFileBytes: this.maximumFileBytes,
        maximumGraphBytes: this.maximumGraphBytes,
        maximumGraphFiles: this.maximumGraphFiles,
      },
    };
    const logicalKey = digest(identity);
    const indexPath = join(this.cacheDirectory, "index", `${logicalKey}.json`);
    const previous = await readJson<CacheIndexEntry>(indexPath, this.maximumCacheEntryBytes);
    if (
      validCacheIndex(previous, sourceDigest) &&
      await dependenciesStillMatch(
        previous.dependencies,
        this.root,
        this.cacheDirectory,
        new Set(),
        dependencyCheckBudget(this, graph),
      )
    ) {
      const cached = await readJson<CacheEnvelope>(
        join(this.cacheDirectory, "objects", `${previous.key}.json`),
        this.maximumCacheEntryBytes,
      );
      const restored = restoreCachedBuild(cached, {
        key: previous.key,
        logicalKey,
        path: portableRelative(this.root, path),
        loader: `${loader.id}@${loader.version}`,
        dependencies: previous.dependencies,
        sourcePath: path,
        sourceBytes: bytes.length,
        contentIdentity: { ...identity, sourceDigest, dependencies: previous.dependencies },
      });
      if (restored) return restored;
    }

    const dependencies = new Map<string, AssetDependency>();
    const activeDependencyRequests = new Set<Promise<unknown>>();
    let dependencyFailure: unknown;
    let dependencyFailed = false;
    const trackDependency = <T>(operation: () => Promise<T>): Promise<T> => {
      const pending = operation().catch((error: unknown) => {
        if (!dependencyFailed) dependencyFailure = error;
        dependencyFailed = true;
        throw error;
      });
      activeDependencyRequests.add(pending);
      void pending.then(
        () => activeDependencyRequests.delete(pending),
        () => activeDependencyRequests.delete(pending),
      );
      return pending;
    };
    const resolveDependency = (specifier: string) => this.#resolveInsideRoot(specifier, dirname(path));
    const context: LoaderContext = Object.freeze({
      target: this.target,
      options: snapshotOptions({ ...this.options, ...optionSnapshot }, "merged asset options"),
      readText: (specifier: string) => trackDependency(async () => {
        const dependencyPath = resolveDependency(specifier);
        const dependencyBytes = await this.#snapshotFile(dependencyPath, graph);
        const text = decodeUtf8(dependencyBytes, portableRelative(this.root, dependencyPath));
        dependencies.set(`${dependencyPath}\0text`, {
          path: portableRelative(this.root, dependencyPath),
          digest: digest(text),
          kind: "file",
          access: "text",
        });
        return text;
      }),
      readBytes: (specifier: string) => trackDependency(async () => {
        const dependencyPath = resolveDependency(specifier);
        const dependencyBytes = await this.#snapshotFile(dependencyPath, graph);
        dependencies.set(`${dependencyPath}\0bytes`, {
          path: portableRelative(this.root, dependencyPath),
          digest: digest(bytesToStableString(dependencyBytes)),
          kind: "file",
          access: "bytes",
        });
        return dependencyBytes.slice();
      }),
      import: (specifier: string, importOptions: Record<string, unknown> = {}) => trackDependency(async () => {
        const dependencyPath = resolveDependency(specifier);
        // Snapshot before the child compilation so the recorded edge and the
        // options that produced it can never disagree.
        const childOptions = snapshotOptions(importOptions, "asset import options");
        const child = await this.#compilePath(dependencyPath, childOptions, [...stack, path], graph);
        dependencies.set(`${dependencyPath}\0asset:${child.logicalKey}`, {
          path: child.path,
          digest: child.key,
          kind: "asset",
          logicalKey: child.logicalKey,
          options: childOptions,
        });
        // Cache-hit state is operational metadata. Exposing it to a loader
        // would allow identical declared inputs to produce different output.
        const { cacheHit: _cacheHit, ...deterministicChild } = child;
        return deterministicChild;
      }),
    });

    const asset: LoaderAsset = Object.freeze({
      // Loader-visible paths are project-relative so output cannot accidentally
      // depend on a checkout's absolute location.
      path: portableRelative(this.root, path),
      get bytes() { return bytes.slice(); },
      text: () => decodeUtf8(bytes, portableRelative(this.root, path)),
    });
    let rawModule: TypedAssetModule | undefined;
    let loaderFailure: unknown;
    let loaderFailed = false;
    try {
      rawModule = await loader.load(asset, context);
    } catch (error) {
      loaderFailed = true;
      loaderFailure = error;
    }
    await Promise.allSettled([...activeDependencyRequests]);
    if (loaderFailed) throw loaderFailure;
    if (dependencyFailed) {
      throw new Error("asset loader recovered from a failed dependency request", { cause: dependencyFailure });
    }
    const module = normalizeLoaderModule(rawModule!, path, bytes.length);
    if (dependencies.size > MAX_CACHED_DEPENDENCIES) {
      throw new Error(`asset loader declared more than ${MAX_CACHED_DEPENDENCIES} dependencies`);
    }
    const dependencyList = Object.freeze(
      [...dependencies.values()]
        .sort(compareDependencies)
        .map((dependency) => Object.freeze({ ...dependency })),
    );
    const contentIdentity = { ...identity, sourceDigest, dependencies: dependencyList };
    const key = digest({ ...contentIdentity, moduleDigest: digest(module) });
    const build: Omit<AssetBuild, "cacheHit"> = {
      path: portableRelative(this.root, path),
      logicalKey,
      key,
      loader: `${loader.id}@${loader.version}`,
      dependencies: dependencyList,
      module,
    };
    const objectCached = await writeJsonAtomic(join(this.cacheDirectory, "objects", `${key}.json`), {
      build,
      outputDigest: digest(build),
    } satisfies CacheEnvelope, this.maximumCacheEntryBytes);
    if (objectCached) {
      await writeJsonAtomic(
        indexPath,
        { sourceDigest, dependencies: dependencyList, key } satisfies CacheIndexEntry,
        this.maximumCacheEntryBytes,
      );
    }
    return Object.freeze({ ...build, cacheHit: false });
  }

  async #snapshotFile(path: string, graph: AssetGraphSnapshot): Promise<Uint8Array> {
    const existing = graph.files.get(path);
    if (existing !== undefined) return existing;
    const active = graph.inflight.get(path);
    if (active !== undefined) return active;
    const pending = (async (): Promise<Uint8Array> => {
      const before = statSync(path);
      if (!before.isFile()) throw new TypeError(`comptime asset must be a regular file: ${path}`);
      if (before.size > this.maximumFileBytes) {
        throw new RangeError(`comptime asset exceeds ${this.maximumFileBytes} bytes: ${portableRelative(this.root, path)}`);
      }
      const raw = await readFile(path);
      const after = statSync(path);
      if (
        raw.byteLength > this.maximumFileBytes || raw.byteLength !== after.size ||
        before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      ) {
        throw new Error(`comptime asset changed while being snapshotted: ${portableRelative(this.root, path)}`);
      }
      const identity = `${after.dev}:${after.ino}`;
      const priorIdentity = graph.identityOwners.get(identity);
      if (priorIdentity !== undefined && priorIdentity !== path) {
        throw new Error(`comptime asset hard-link aliases are forbidden: ${priorIdentity} and ${path}`);
      }
      if (graph.files.size >= this.maximumGraphFiles) {
        throw new RangeError(`comptime asset graph exceeds ${this.maximumGraphFiles} files`);
      }
      if (graph.totalBytes + raw.byteLength > this.maximumGraphBytes) {
        throw new RangeError(`comptime asset graph exceeds ${this.maximumGraphBytes} bytes`);
      }
      const snapshot = Uint8Array.from(raw);
      graph.identityOwners.set(identity, path);
      graph.files.set(path, snapshot);
      graph.totalBytes += snapshot.byteLength;
      return snapshot;
    })();
    graph.inflight.set(path, pending);
    try {
      return await pending;
    } finally {
      if (graph.inflight.get(path) === pending) graph.inflight.delete(path);
    }
  }

  #resolveInsideRoot(specifier: string, from: string): string {
    if (isAbsolute(specifier)) throw new Error(`comptime assets must use root-relative or relative imports: ${specifier}`);
    // A lexical `..` check alone lets an in-root symlink grant ambient
    // filesystem authority, so canonicalize before applying the boundary.
    const resolved = realpathSync(resolve(from, specifier));
    const back = relative(this.root, resolved);
    if (back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) {
      throw new Error(`comptime asset escaped project root: ${specifier}`);
    }
    let activeCacheDirectory = this.cacheDirectory;
    try {
      activeCacheDirectory = realpathSync(this.cacheDirectory);
      if (activeCacheDirectory !== this.cacheDirectory) {
        throw new Error("asset compiler cache directory changed filesystem authority");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const cacheBack = relative(activeCacheDirectory, resolved);
    if (cacheBack === "" || (!isAbsolute(cacheBack) && cacheBack !== ".." && !cacheBack.startsWith(`..${sep}`))) {
      throw new Error(`comptime assets cannot read compiler-owned cache files: ${specifier}`);
    }
    if (!statSync(resolved).isFile()) throw new Error(`comptime asset must be a regular file: ${specifier}`);
    return resolved;
  }
}

function snapshotOptions(
  options: Readonly<Record<string, unknown>>,
  label: string,
): Readonly<Record<string, unknown>> {
  const cloned = stableClone(options, label);
  if (cloned === null || Array.isArray(cloned) || typeof cloned !== "object") {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return freezeStable(cloned) as Readonly<Record<string, unknown>>;
}

function positiveLimit(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return selected;
}

/** Canonicalize a path even when its final cache directories do not exist yet. */
function canonicalFuturePath(path: string): string {
  let cursor = resolve(path);
  const missing: string[] = [];
  for (;;) {
    try {
      return resolve(realpathSync(cursor), ...missing.reverse());
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(basename(cursor));
      cursor = parent;
    }
  }
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`comptime text asset is not valid UTF-8: ${label}`);
  }
}

function validCacheIndex(entry: CacheIndexEntry | undefined, sourceDigest: string): entry is CacheIndexEntry {
  return entry !== undefined &&
    entry.sourceDigest === sourceDigest &&
    SHA256.test(entry.key) &&
    Array.isArray(entry.dependencies) &&
    entry.dependencies.length <= MAX_CACHED_DEPENDENCIES &&
    entry.dependencies.every(validDependency);
}

function validDependency(dependency: AssetDependency): boolean {
  return dependency !== null && typeof dependency === "object" &&
    typeof dependency.path === "string" && SHA256.test(dependency.digest) &&
    (dependency.kind === "file"
      ? dependency.access === "text" || dependency.access === "bytes"
      : dependency.kind === "asset" && typeof dependency.logicalKey === "string" &&
        SHA256.test(dependency.logicalKey) && validDependencyOptions(dependency.options));
}

/** Cached edge metadata is untrusted input; only durable JSON objects qualify. */
function validDependencyOptions(options: unknown): boolean {
  if (options === undefined) return true;
  try {
    const cloned = stableClone(options, "asset dependency options");
    return cloned !== null && typeof cloned === "object" && !Array.isArray(cloned);
  } catch {
    return false;
  }
}

function restoreCachedBuild(
  envelope: CacheEnvelope | undefined,
  expected: {
    key: string;
    logicalKey: string;
    path: string;
    loader: string;
    dependencies: readonly AssetDependency[];
    sourcePath: string;
    sourceBytes: number;
    contentIdentity: Record<string, unknown>;
  },
): AssetBuild | undefined {
  if (!envelope || typeof envelope.outputDigest !== "string") return undefined;
  try {
    if (digest(envelope.build) !== envelope.outputDigest) return undefined;
    const build = stableClone(envelope.build, "cached asset build") as unknown as Omit<AssetBuild, "cacheHit">;
    if (
      build.key !== expected.key || build.logicalKey !== expected.logicalKey ||
      build.path !== expected.path || build.loader !== expected.loader ||
      canonical(build.dependencies) !== canonical(expected.dependencies) ||
      digest({ ...expected.contentIdentity, moduleDigest: digest(build.module) }) !== expected.key
    ) return undefined;
    const module = normalizeLoaderModule(build.module, expected.sourcePath, expected.sourceBytes);
    const dependencies = freezeStable(build.dependencies as unknown as StableJson) as unknown as readonly AssetDependency[];
    return Object.freeze({
      path: build.path,
      logicalKey: build.logicalKey,
      key: build.key,
      loader: build.loader,
      dependencies,
      module,
      cacheHit: true,
    });
  } catch {
    return undefined;
  }
}

function normalizeLoaderModule(raw: TypedAssetModule, sourcePath: string, sourceBytes: number): TypedAssetModule {
  const module = stableClone(raw, "loader module") as unknown as TypedAssetModule;
  if (
    typeof module.format !== "string" || typeof module.emittedTypeScript !== "string" ||
    typeof module.declaration !== "string" || !Array.isArray(module.diagnostics) || !Array.isArray(module.spans)
  ) throw new TypeError(`loader output for ${sourcePath} has an invalid module shape`);
  for (const diagnostic of module.diagnostics) {
    if (
      diagnostic === null || typeof diagnostic !== "object" ||
      !["warning", "error"].includes(diagnostic.level) || typeof diagnostic.message !== "string" ||
      (diagnostic.offset !== undefined && (
        !Number.isSafeInteger(diagnostic.offset) || diagnostic.offset < 0 || diagnostic.offset > sourceBytes
      ))
    ) throw new TypeError(`loader output for ${sourcePath} has an invalid diagnostic`);
  }
  for (const span of module.spans) {
    if (span === null || typeof span !== "object") {
      throw new TypeError(`loader output for ${sourcePath} has an invalid span`);
    }
  }
  const reported = module.diagnostics.filter((diagnostic) => diagnostic.level === "error");
  const parse = (text: string, fileName: string): string[] => {
    const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const diagnostics = (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
    return diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  };
  const syntax = [
    ...parse(module.emittedTypeScript, `${sourcePath}.generated.ts`),
    ...parse(module.declaration, `${sourcePath}.generated.d.ts`),
  ];
  for (const span of module.spans) {
    if (!Number.isSafeInteger(span.generatedOffset) || span.generatedOffset < 0 || span.generatedOffset > module.emittedTypeScript.length) {
      syntax.push(`invalid generated span offset ${span.generatedOffset}`);
    }
    if (!Number.isSafeInteger(span.sourceOffset) || span.sourceOffset < 0 || span.sourceOffset > sourceBytes) {
      syntax.push(`invalid source span offset ${span.sourceOffset}`);
    }
  }
  if (reported.length > 0 || syntax.length > 0) {
    const messages = [...reported.map((diagnostic) => diagnostic.message), ...syntax];
    throw new SyntaxError(`loader output for ${sourcePath} is invalid: ${messages.join("; ")}`);
  }
  return freezeStable(module as unknown as StableJson) as unknown as TypedAssetModule;
}

function portableRelative(from: string, to: string): string {
  return relative(from, to).split(sep).join("/");
}

function bytesToStableString(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function dependenciesStillMatch(
  dependencies: readonly AssetDependency[],
  root: string,
  cacheDirectory: string,
  visited = new Set<string>(),
  budget: DependencyCheckBudget,
): Promise<boolean> {
  if (dependencies.length > budget.remaining) return false;
  budget.remaining -= dependencies.length;
  for (const dependency of dependencies) {
    try {
      if (!validDependency(dependency)) return false;
      const dependencyPath = realpathSync(resolve(root, dependency.path));
      const back = relative(root, dependencyPath);
      if (back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) return false;
      // Cache metadata is untrusted input. A dependency produced by this
      // compiler is always the canonical portable spelling beneath root; a
      // different spelling could follow a newly introduced alias or smuggle
      // compiler-owned cache state into the loader's declared input graph.
      if (dependency.path !== portableRelative(root, dependencyPath)) return false;
      const cacheBack = relative(cacheDirectory, dependencyPath);
      if (
        cacheBack === "" ||
        (!isAbsolute(cacheBack) && cacheBack !== ".." && !cacheBack.startsWith(`..${sep}`))
      ) return false;
      const bytes = await dependencySnapshot(dependencyPath, budget);
      if (bytes === undefined) return false;
      if (dependency.kind === "file") {
        const currentDigest = dependency.access === "text"
          ? digest(decodeUtf8(bytes, dependency.path))
          : digest(bytesToStableString(bytes));
        if (dependency.digest !== currentDigest) return false;
        continue;
      }
      if (!dependency.logicalKey || visited.has(dependency.logicalKey)) return false;
      visited.add(dependency.logicalKey);
      const nested = await readJson<CacheIndexEntry>(
        join(cacheDirectory, "index", `${dependency.logicalKey}.json`),
        budget.maximumCacheEntryBytes,
      );
      const nestedSourceDigest = digest(bytesToStableString(bytes));
      const invalid =
        !validCacheIndex(nested, nestedSourceDigest) ||
        nested.key !== dependency.digest ||
        !await dependenciesStillMatch(nested.dependencies, root, cacheDirectory, visited, budget);
      visited.delete(dependency.logicalKey);
      if (invalid) return false;
    } catch {
      return false;
    }
  }
  return true;
}

interface DependencyCheckBudget {
  remaining: number;
  readonly maximumFileBytes: number;
  readonly maximumGraphBytes: number;
  readonly maximumGraphFiles: number;
  readonly maximumCacheEntryBytes: number;
  readonly files: Map<string, Uint8Array>;
  readonly identityOwners: Map<string, string>;
  totalBytes: number;
}

function dependencyCheckBudget(
  compiler: AssetCompiler,
  graph?: AssetGraphSnapshot,
): DependencyCheckBudget {
  return {
    remaining: MAX_CACHED_DEPENDENCIES,
    maximumFileBytes: compiler.maximumFileBytes,
    maximumGraphBytes: compiler.maximumGraphBytes,
    maximumGraphFiles: compiler.maximumGraphFiles,
    maximumCacheEntryBytes: compiler.maximumCacheEntryBytes,
    // Cache validation is part of the same top-level graph as the source
    // snapshot. Seeding both bytes and inode ownership prevents validation
    // from accepting a dependency that has become a hard-link alias of that
    // source, and avoids double-counting a loader which explicitly reads its
    // own source path.
    files: new Map(graph?.files ?? []),
    identityOwners: new Map(graph?.identityOwners ?? []),
    totalBytes: graph?.totalBytes ?? 0,
  };
}

async function dependencySnapshot(
  path: string,
  budget: DependencyCheckBudget,
): Promise<Uint8Array | undefined> {
  const existing = budget.files.get(path);
  if (existing !== undefined) return existing;
  const before = statSync(path);
  if (!before.isFile() || before.size > budget.maximumFileBytes) return undefined;
  const raw = await readFile(path);
  const after = statSync(path);
  if (
    raw.byteLength > budget.maximumFileBytes || raw.byteLength !== after.size ||
    before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
  ) return undefined;
  const identity = `${after.dev}:${after.ino}`;
  const priorIdentity = budget.identityOwners.get(identity);
  if (priorIdentity !== undefined && priorIdentity !== path) return undefined;
  if (budget.files.size >= budget.maximumGraphFiles) return undefined;
  if (budget.totalBytes + raw.byteLength > budget.maximumGraphBytes) return undefined;
  const snapshot = Uint8Array.from(raw);
  budget.files.set(path, snapshot);
  budget.identityOwners.set(identity, path);
  budget.totalBytes += snapshot.byteLength;
  return snapshot;
}

function compareDependencies(left: AssetDependency, right: AssetDependency): number {
  return compareStableStrings(left.path, right.path) || compareStableStrings(canonical(left), canonical(right));
}

async function readJson<T>(path: string, maximumBytes: number): Promise<T | undefined> {
  try {
    // Never follow an ancestry swap in a compiler-owned cache path. Cache
    // corruption is a miss; ambient-file authority is not an acceptable miss.
    if (realpathSync(dirname(path)) !== resolve(dirname(path))) return undefined;
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes) return undefined;
    const bytes = await readFile(path);
    const after = lstatSync(path);
    if (
      !after.isFile() || after.isSymbolicLink() || bytes.byteLength > maximumBytes ||
      bytes.byteLength !== after.size || before.dev !== after.dev || before.ino !== after.ino ||
      before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
    ) return undefined;
    return JSON.parse(decodeUtf8(bytes, path)) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SyntaxError || error instanceof TypeError) return undefined;
    throw error;
  }
}

async function writeJsonAtomic(path: string, value: unknown, maximumBytes: number): Promise<boolean> {
  const payload = `${canonical(value)}\n`;
  // The cache is an optimization. A valid build that happens to produce a
  // large envelope must not create an unbounded cache file or fail solely
  // because caching was declined.
  if (Buffer.byteLength(payload) > maximumBytes) return false;
  const directory = resolve(dirname(path));
  if (canonicalFuturePath(directory) !== directory) {
    throw new Error(`asset compiler cache directory changed filesystem authority: ${directory}`);
  }
  await mkdir(directory, { recursive: true });
  if (realpathSync(directory) !== directory || !statSync(directory).isDirectory()) {
    throw new Error(`asset compiler cache directory is not canonical: ${directory}`);
  }
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, payload, { flag: "wx" });
    if (realpathSync(directory) !== directory) {
      throw new Error(`asset compiler cache directory changed before commit: ${directory}`);
    }
    await rename(temporary, path);
    return true;
  } finally {
    await rm(temporary, { force: true });
  }
}

function constLiteral(value: StableJson): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(constLiteral).join(", ")}]`;
  // Computed string-literal keys preserve an own `__proto__` data field.
  return `{ ${Object.keys(value).map((key) => `[${JSON.stringify(key)}]: ${constLiteral(value[key]!)}`).join(", ")} }`;
}

export const jsonLoader: AssetLoader = {
  id: "smithers:builtin/json",
  version: "1",
  implementationDigest: "builtin-json-poc-v1",
  extensions: [".json"],
  types: ["json"],
  load(asset, context) {
    const source = asset.text();
    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new SyntaxError(`${asset.path}: ${(error as Error).message}`);
    }
    const literal = constLiteral(stableClone(value));
    const preserveLiterals = context.options.mode === "const" || context.options.const === true;
    if (context.options.mode !== undefined && context.options.mode !== "const") {
      throw new TypeError("JSON asset mode must be 'const' when provided");
    }
    return {
      format: preserveLiterals ? "json-const" : "json",
      value,
      emittedTypeScript: `const value = ${literal}${preserveLiterals ? " as const" : ""};\nexport default value;\n`,
      declaration: "declare const value: typeof import(\"./asset.generated.ts\").default;\nexport default value;\n",
      diagnostics: [],
      spans: [{ generatedOffset: 14, sourceOffset: 0 }],
    };
  },
};

export const textLoader: AssetLoader = {
  id: "smithers:builtin/text",
  version: "1",
  implementationDigest: "builtin-text-poc-v1",
  extensions: [".txt", ".text"],
  types: ["text"],
  load(asset) {
    const source = asset.text();
    return {
      format: "text",
      value: source,
      emittedTypeScript: `const value = ${JSON.stringify(source)};\nexport default value;\n`,
      declaration: "declare const value: string;\nexport default value;\n",
      diagnostics: [],
      spans: [{ generatedOffset: 14, sourceOffset: 0 }],
    };
  },
};

export const bytesLoader: AssetLoader = {
  id: "smithers:builtin/bytes",
  version: "1",
  implementationDigest: "builtin-bytes-poc-v1",
  extensions: [],
  types: ["bytes"],
  load(asset) {
    const bytes = [...asset.bytes];
    return {
      format: "bytes",
      value: bytes,
      emittedTypeScript: `const value = new Uint8Array(${JSON.stringify(bytes)});\nexport default value;\n`,
      declaration: "declare const value: Uint8Array;\nexport default value;\n",
      diagnostics: [],
      spans: [{ generatedOffset: 35, sourceOffset: 0 }],
    };
  },
};

/* --------------------------------------------------------------------------
 * Provisional Markdown/MDX built-ins
 *
 * docs/ASSET_LOADERS.md fixes the `.md` string default and the "MDX emits a
 * typed component module" requirement, and leaves the parsed-document,
 * frontmatter, and component-module shapes open. Everything below is a
 * labeled-provisional candidate for those open slots. It is deliberately a
 * bounded, strict subset: an authored construct the subset does not describe
 * is a source-located diagnostic, never a silently different value.
 * -------------------------------------------------------------------------- */

/** A source-located problem inside an authored asset (not inside loader output). */
export interface AssetSourceIssue {
  readonly message: string;
  /** UTF-16 offset into the authored asset text. */
  readonly offset: number;
  /** 1-based line of `offset`. */
  readonly line: number;
  /** 1-based column of `offset`. */
  readonly column: number;
}

/**
 * Thrown by a built-in loader when the authored asset itself is malformed.
 * `AssetDiagnostic` can only travel inside a module the loader managed to
 * produce, so a source error that prevents a module carries its locations
 * here instead of degrading to an unlocated message.
 */
export class AssetSourceError extends SyntaxError {
  readonly path: string;
  readonly offset: number;
  readonly line: number;
  readonly column: number;
  readonly issues: readonly AssetSourceIssue[];
  readonly diagnostics: readonly AssetDiagnostic[];

  constructor(path: string, issues: readonly AssetSourceIssue[]) {
    const first = issues[0];
    if (first === undefined) throw new TypeError("an asset source error requires at least one issue");
    const extra = issues.length > 1 ? ` (+${issues.length - 1} more)` : "";
    super(`${path}:${first.line}:${first.column}: ${first.message}${extra}`);
    this.name = "AssetSourceError";
    this.path = path;
    this.offset = first.offset;
    this.line = first.line;
    this.column = first.column;
    this.issues = Object.freeze(issues.map((issue) => Object.freeze({ ...issue })));
    this.diagnostics = Object.freeze(this.issues.map((issue) => Object.freeze({
      level: "error" as const,
      message: issue.message,
      offset: issue.offset,
    })));
  }
}

interface SourceLine {
  readonly text: string;
  readonly offset: number;
}

/** Split on `\n`, keep absolute offsets, and tolerate CRLF without moving them. */
function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let offset = 0;
  for (;;) {
    const newline = source.indexOf("\n", offset);
    const end = newline < 0 ? source.length : newline;
    const raw = source.slice(offset, end);
    lines.push({ text: raw.endsWith("\r") ? raw.slice(0, -1) : raw, offset });
    if (newline < 0) return lines;
    offset = newline + 1;
  }
}

function sourceIssue(source: string, offset: number, message: string): AssetSourceIssue {
  const bounded = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < bounded; index++) {
    if (source.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { message, offset: bounded, line, column: bounded - lineStart + 1 };
}

const MAX_FRONTMATTER_ENTRIES = 256;
const MAX_MDX_NODES = 4_096;
const MAX_MDX_DEPTH = 32;
const FRONTMATTER_ENTRY = /^([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:(.*)$/;
const YAML_NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
/** Scalars YAML implementations disagree about. The subset demands quotes. */
const YAML_AMBIGUOUS_WORD =
  /^(?:~|[Nn]ull|NULL|[Yy]es|YES|[Nn]o|NO|[Oo]n|ON|[Oo]ff|OFF|True|TRUE|False|FALSE|[-+]?\.(?:inf|Inf|INF|nan|NaN|NAN))$/;
const YAML_AMBIGUOUS_NUMBER =
  /^[-+]?(?:0[xXoObB][0-9A-Fa-f_]+|(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9][0-9_]*)(?:[eE][-+]?[0-9]+)?)$/;
const YAML_PLAIN_INDICATOR = /^[-?:,[\]{}#&*!|>%@`'"]/;

type FrontmatterScalar = string | number | boolean;
export type MarkdownFrontmatter = Readonly<Record<string, FrontmatterScalar | Readonly<Record<string, FrontmatterScalar>> | readonly FrontmatterScalar[]>>;

interface FrontmatterParse {
  readonly present: boolean;
  readonly frontmatter: Record<string, StableJson>;
  readonly body: string;
  readonly bodyOffset: number;
}

type IssueSink = (offset: number, message: string) => void;

/**
 * The provisional front-matter subset: scalar strings/numbers/booleans, flat
 * maps, exactly one level of nested maps, and scalar lists. `true`/`false` and
 * canonical JSON-shaped numbers are typed; every other YAML spelling that a
 * reader could interpret two ways must be quoted.
 */
function parseYamlScalar(text: string, offset: number, report: IssueSink): FrontmatterScalar | undefined {
  if (text.length === 0) {
    report(offset, "front matter value is empty; write a quoted string for an empty value");
    return undefined;
  }
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    if (text.length < 2 || !text.endsWith(quote)) {
      report(offset, `unterminated ${quote === '"' ? "double" : "single"}-quoted front matter scalar`);
      return undefined;
    }
    const inner = text.slice(1, -1);
    let output = "";
    for (let index = 0; index < inner.length; index++) {
      const character = inner[index]!;
      if (quote === "'") {
        if (character !== "'") {
          output += character;
          continue;
        }
        if (inner[index + 1] === "'") {
          output += "'";
          index += 1;
          continue;
        }
        report(offset + 1 + index, "single-quoted front matter scalars escape a quote as ''");
        return undefined;
      }
      if (character === '"') {
        report(offset + 1 + index, "double-quoted front matter scalars must escape an inner quote as \\\"");
        return undefined;
      }
      if (character !== "\\") {
        output += character;
        continue;
      }
      const escape = inner[index + 1];
      const mapped = escape === "n" ? "\n" : escape === "t" ? "\t" : escape === '"' ? '"' : escape === "\\" ? "\\" : undefined;
      if (mapped === undefined) {
        report(offset + 1 + index, "front matter strings support only the \\\\, \\\", \\n, and \\t escapes");
        return undefined;
      }
      output += mapped;
      index += 1;
    }
    return output;
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (YAML_NUMBER.test(text)) return Number(text);
  if (YAML_AMBIGUOUS_WORD.test(text) || YAML_AMBIGUOUS_NUMBER.test(text)) {
    report(offset, `ambiguous YAML scalar '${text}'; quote it to keep a string`);
    return undefined;
  }
  if (YAML_PLAIN_INDICATOR.test(text)) {
    report(offset, `front matter scalars cannot start with '${text[0]}'; quote the value`);
    return undefined;
  }
  if (text.includes(": ") || text.includes(" #") || text.endsWith(":")) {
    report(offset, "front matter plain scalars cannot contain ': ' or a trailing comment; quote the value");
    return undefined;
  }
  return text;
}

function parseFrontmatter(source: string, path: string): FrontmatterParse {
  const empty = Object.create(null) as Record<string, StableJson>;
  const lines = sourceLines(source);
  if (lines.length === 0 || lines[0]!.text !== "---") {
    return { present: false, frontmatter: empty, body: source, bodyOffset: 0 };
  }
  const issues: AssetSourceIssue[] = [];
  const report: IssueSink = (offset, message) => { issues.push(sourceIssue(source, offset, message)); };
  let closing = -1;
  for (let index = 1; index < lines.length; index++) {
    if (lines[index]!.text === "---") {
      closing = index;
      break;
    }
  }
  if (closing < 0) {
    throw new AssetSourceError(path, [sourceIssue(source, 0, "unterminated front matter block: expected a closing '---' line")]);
  }
  const bodyOffset = lines[closing + 1]?.offset ?? source.length;
  const frontmatter = Object.create(null) as Record<string, StableJson>;
  const inner = lines.slice(1, closing);
  let entries = 0;
  let index = 0;
  const budget = (offset: number): boolean => {
    if (++entries <= MAX_FRONTMATTER_ENTRIES) return true;
    report(offset, `front matter exceeds ${MAX_FRONTMATTER_ENTRIES} entries`);
    return false;
  };
  while (index < inner.length) {
    const line = inner[index]!;
    const text = line.text;
    if (text.trim() === "") {
      index += 1;
      continue;
    }
    const indent = text.length - text.trimStart().length;
    if (text.slice(indent).startsWith("#")) {
      index += 1;
      continue;
    }
    const tab = text.indexOf("\t");
    if (tab >= 0) {
      report(line.offset + tab, "front matter cannot contain tabs");
      index += 1;
      continue;
    }
    if (indent !== 0) {
      report(line.offset + indent, "unexpected front matter indentation: a mapping key starts at column 1");
      index += 1;
      continue;
    }
    const matched = FRONTMATTER_ENTRY.exec(text);
    if (matched === null) {
      report(line.offset, "front matter entries must be written as 'key: value'");
      index += 1;
      continue;
    }
    const key = matched[1]!;
    const rest = matched[2]!;
    if (Object.hasOwn(frontmatter, key)) {
      report(line.offset, `duplicate front matter key '${key}'`);
      index += 1;
      continue;
    }
    if (!budget(line.offset)) break;
    const restOffset = line.offset + text.length - rest.length;
    const valueText = rest.trim();
    if (valueText.length > 0) {
      const scalar = parseYamlScalar(valueText, restOffset + (rest.length - rest.trimStart().length), report);
      if (scalar !== undefined) frontmatter[key] = scalar;
      index += 1;
      continue;
    }
    let cursor = index + 1;
    const block: SourceLine[] = [];
    while (cursor < inner.length) {
      const candidate = inner[cursor]!;
      const trimmed = candidate.text.trim();
      if (trimmed === "") {
        cursor += 1;
        continue;
      }
      if (candidate.text.trimStart().length === candidate.text.length) break;
      if (trimmed.startsWith("#")) {
        cursor += 1;
        continue;
      }
      block.push(candidate);
      cursor += 1;
    }
    index = cursor;
    if (block.length === 0) {
      report(line.offset, `front matter key '${key}' has no value`);
      continue;
    }
    const list = /^ {2}-(?:[ ]|$)/.test(block[0]!.text);
    const items: StableJson[] = [];
    const nested = Object.create(null) as Record<string, StableJson>;
    let failed = false;
    for (const entry of block) {
      const entryIndent = entry.text.length - entry.text.trimStart().length;
      if (entry.text.includes("\t")) {
        report(entry.offset + entry.text.indexOf("\t"), "front matter cannot contain tabs");
        failed = true;
        continue;
      }
      if (entryIndent !== 2) {
        report(entry.offset + entryIndent, "front matter supports one nested level indented by exactly two spaces");
        failed = true;
        continue;
      }
      if (!budget(entry.offset)) {
        failed = true;
        break;
      }
      const content = entry.text.slice(2);
      if (list !== /^-(?:[ ]|$)/.test(content)) {
        report(entry.offset + 2, `front matter block for '${key}' mixes list items and mapping entries`);
        failed = true;
        continue;
      }
      if (list) {
        const dash = /^-[ ]*/.exec(content)![0];
        const itemText = content.slice(dash.length).trimEnd();
        const item = parseYamlScalar(itemText, entry.offset + 2 + dash.length, report);
        if (item === undefined) failed = true;
        else items.push(item);
        continue;
      }
      const entryMatch = FRONTMATTER_ENTRY.exec(content);
      if (entryMatch === null) {
        report(entry.offset + 2, "nested front matter entries must be written as 'key: value'");
        failed = true;
        continue;
      }
      const nestedKey = entryMatch[1]!;
      const nestedRest = entryMatch[2]!;
      if (Object.hasOwn(nested, nestedKey)) {
        report(entry.offset + 2, `duplicate front matter key '${key}.${nestedKey}'`);
        failed = true;
        continue;
      }
      const nestedText = nestedRest.trim();
      if (nestedText.length === 0) {
        report(entry.offset + 2, "front matter supports one nested level; a nested value must be a scalar");
        failed = true;
        continue;
      }
      const nestedOffset = entry.offset + 2 + content.length - nestedRest.length + (nestedRest.length - nestedRest.trimStart().length);
      const scalar = parseYamlScalar(nestedText, nestedOffset, report);
      if (scalar === undefined) failed = true;
      else nested[nestedKey] = scalar;
    }
    if (!failed) frontmatter[key] = list ? items : nested;
  }
  if (issues.length > 0) throw new AssetSourceError(path, issues);
  return { present: true, frontmatter, body: source.slice(bodyOffset), bodyOffset };
}

export interface MarkdownHeading {
  readonly level: number;
  readonly text: string;
  /** UTF-16 offset of the heading's first `#` in the authored source. */
  readonly offset: number;
}

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** ATX headings only, skipping fenced code. Setext headings stay out of scope. */
function extractHeadings(body: string, bodyOffset: number): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  let fence = "";
  let fenceLength = 0;
  for (const line of sourceLines(body)) {
    const fenced = CODE_FENCE.exec(line.text);
    if (fence !== "") {
      if (fenced !== null && fenced[1]![0] === fence && fenced[1]!.length >= fenceLength && fenced[2]!.trim() === "") fence = "";
      continue;
    }
    if (fenced !== null && !(fenced[1]![0] === "`" && fenced[2]!.includes("`"))) {
      fence = fenced[1]![0]!;
      fenceLength = fenced[1]!.length;
      continue;
    }
    const heading = ATX_HEADING.exec(line.text);
    if (heading === null) continue;
    const text = (heading[2] ?? "").replace(/(^|[ \t])#+[ \t]*$/, "").trim();
    headings.push({
      level: heading[1]!.length,
      text,
      offset: bodyOffset + line.offset + (line.text.length - line.text.trimStart().length),
    });
  }
  return headings;
}

/** Append-only text buffer that records generated-to-source span anchors. */
class GeneratedEmitter {
  #chunks: string[] = [];
  #length = 0;
  readonly spans: SpanMapping[] = [];

  write(text: string): void {
    this.#chunks.push(text);
    this.#length += text.length;
  }

  mark(sourceOffset: number): void {
    this.spans.push({ generatedOffset: this.#length, sourceOffset });
  }

  toString(): string {
    return this.#chunks.join("");
  }
}

const dataLiteral = (value: unknown): string => {
  const stable = stableClone(value);
  if (stable !== null && typeof stable === "object" && !Array.isArray(stable) && Object.keys(stable).length === 0) return "{}";
  return constLiteral(stable);
};

const indentation = (depth: number): string => "  ".repeat(depth);

export const markdownLoader: AssetLoader = {
  id: "smithers:builtin/markdown",
  version: "2",
  implementationDigest: "builtin-markdown-poc-v2",
  extensions: [".md"],
  types: ["markdown"],
  load(asset) {
    const source = asset.text();
    const parsed = parseFrontmatter(source, asset.path);
    const headings = extractHeadings(parsed.body, parsed.bodyOffset);
    const emitter = new GeneratedEmitter();
    emitter.mark(0);
    emitter.write(`export const frontmatter = ${dataLiteral(parsed.frontmatter)} as const;\n`);
    emitter.write(`export const body = ${JSON.stringify(parsed.body)};\n`);
    emitter.write("export const headings = ");
    if (headings.length === 0) emitter.write("[]");
    else {
      emitter.write("[\n");
      for (const heading of headings) {
        emitter.write(indentation(1));
        emitter.mark(heading.offset);
        emitter.write(`{ ["level"]: ${heading.level}, ["text"]: ${JSON.stringify(heading.text)}, ["offset"]: ${heading.offset} },\n`);
      }
      emitter.write("]");
    }
    emitter.write(" as const;\n");
    emitter.mark(0);
    emitter.write(`export const source = ${JSON.stringify(source)};\n`);
    emitter.write("export default source;\n");
    return {
      format: "markdown",
      value: { source, body: parsed.body, bodyOffset: parsed.bodyOffset, frontmatter: parsed.frontmatter, headings },
      emittedTypeScript: emitter.toString(),
      declaration: [
        'export declare const frontmatter: typeof import("./asset.generated.ts").frontmatter;',
        "export declare const body: string;",
        'export declare const headings: typeof import("./asset.generated.ts").headings;',
        "export declare const source: string;",
        "export default source;",
        "",
      ].join("\n"),
      diagnostics: [],
      spans: emitter.spans,
    };
  },
};

export type MdxPropValue = string | number | boolean;

export interface MdxElementNode {
  readonly kind: "element";
  readonly name: string;
  readonly props: Readonly<Record<string, MdxPropValue>>;
  readonly children: readonly MdxNode[];
}

export interface MdxTextNode {
  readonly kind: "text";
  readonly value: string;
}

/** A `{name}` hole. Comptime never evaluates it; a library substitutes it. */
export interface MdxExpressionNode {
  readonly kind: "expression";
  readonly placeholder: string;
}

export type MdxNode = MdxElementNode | MdxTextNode | MdxExpressionNode;

interface ParsedElement {
  kind: "element";
  name: string;
  props: Record<string, MdxPropValue>;
  children: ParsedNode[];
  offset: number;
}
interface ParsedText {
  kind: "text";
  value: string;
  offset: number;
}
interface ParsedExpression {
  kind: "expression";
  placeholder: string;
  offset: number;
}
type ParsedNode = ParsedElement | ParsedText | ParsedExpression;

const MDX_TAG_NAME = /^[A-Za-z][A-Za-z0-9._-]*/;
const MDX_ATTRIBUTE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*/;
const MDX_CLOSING_TAG = /^<\/([A-Za-z][A-Za-z0-9._-]*)[ \t]*>/;
const MDX_PLACEHOLDER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Markdown regions that are literal text even though they contain `<` or `{`.
 * Without this a fenced code sample inside a prompt would be parsed as JSX.
 */
function protectedRanges(body: string): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  let fence = "";
  let fenceLength = 0;
  let fenceStart = 0;
  for (const line of sourceLines(body)) {
    const fenced = CODE_FENCE.exec(line.text);
    if (fence !== "") {
      if (fenced !== null && fenced[1]![0] === fence && fenced[1]!.length >= fenceLength && fenced[2]!.trim() === "") {
        ranges.push([fenceStart, line.offset + line.text.length]);
        fence = "";
      }
      continue;
    }
    if (fenced !== null && !(fenced[1]![0] === "`" && fenced[2]!.includes("`"))) {
      fence = fenced[1]![0]!;
      fenceLength = fenced[1]!.length;
      fenceStart = line.offset;
    }
  }
  if (fence !== "") ranges.push([fenceStart, body.length]);
  // The fenced ranges are sorted and disjoint, so one advancing cursor keeps
  // the inline-span scan linear. A code span may never cross into a fence,
  // which is what keeps the combined range list disjoint as well.
  const spans: Array<readonly [number, number]> = [];
  let fenceIndex = 0;
  let index = 0;
  while (index < body.length) {
    while (fenceIndex < ranges.length && ranges[fenceIndex]![1] <= index) fenceIndex += 1;
    const next = ranges[fenceIndex];
    if (next !== undefined && index >= next[0]) {
      index = next[1];
      continue;
    }
    if (body[index] !== "`") {
      index += 1;
      continue;
    }
    const limit = next?.[0] ?? body.length;
    let run = 0;
    while (body[index + run] === "`") run += 1;
    const marker = "`".repeat(run);
    let cursor = index + run;
    let close = -1;
    for (;;) {
      const found = body.indexOf(marker, cursor);
      if (found < 0 || found + run > limit) break;
      if (body[found + run] !== "`") {
        close = found;
        break;
      }
      cursor = found + run;
      while (body[cursor] === "`") cursor += 1;
    }
    if (close < 0) {
      index += run;
      continue;
    }
    spans.push([index, close + run]);
    index = close + run;
  }
  return [...ranges, ...spans].sort((left, right) => left[0] - right[0]);
}

function parseMdx(body: string, bodyOffset: number, source: string, path: string): ParsedNode[] {
  const fail: (offset: number, message: string) => never = (offset, message) => {
    throw new AssetSourceError(path, [sourceIssue(source, offset, message)]);
  };
  const root: ParsedNode[] = [];
  const stack: Array<{ readonly name: string; readonly offset: number; readonly children: ParsedNode[] }> = [];
  const ranges = protectedRanges(body);
  let rangeIndex = 0;
  let nodes = 0;
  let text = "";
  let textStart = 0;
  let index = 0;
  const children = (): ParsedNode[] => stack[stack.length - 1]?.children ?? root;
  const admit = (offset: number): void => {
    if (++nodes > MAX_MDX_NODES) fail(bodyOffset + offset, `MDX document exceeds ${MAX_MDX_NODES} nodes`);
  };
  const append = (chunk: string, start: number): void => {
    if (text.length === 0) textStart = start;
    text += chunk;
  };
  const flush = (): void => {
    if (text.length === 0) return;
    admit(textStart);
    children().push({ kind: "text", value: text, offset: bodyOffset + textStart });
    text = "";
  };
  while (index < body.length) {
    while (rangeIndex < ranges.length && ranges[rangeIndex]![1] <= index) rangeIndex += 1;
    const range = ranges[rangeIndex];
    if (range !== undefined && index >= range[0]) {
      append(body.slice(index, range[1]), index);
      index = range[1];
      continue;
    }
    const character = body[index]!;
    if (character === "{") {
      const end = body.indexOf("}", index + 1);
      if (end < 0) fail(bodyOffset + index, "unterminated MDX expression: expected '}'");
      const inner = body.slice(index + 1, end);
      if (inner.includes("{")) fail(bodyOffset + index, "MDX expression holes cannot nest braces");
      const placeholder = inner.trim();
      if (!MDX_PLACEHOLDER.test(placeholder)) {
        fail(
          bodyOffset + index,
          "an MDX expression hole must name one identifier placeholder; comptime never evaluates the expression",
        );
      }
      flush();
      admit(index);
      children().push({ kind: "expression", placeholder, offset: bodyOffset + index });
      index = end + 1;
      continue;
    }
    if (character !== "<") {
      append(character, index);
      index += 1;
      continue;
    }
    if (body[index + 1] === "/") {
      const closing = MDX_CLOSING_TAG.exec(body.slice(index));
      if (closing === null) fail(bodyOffset + index, "malformed MDX closing tag");
      const open = stack[stack.length - 1];
      if (open === undefined) fail(bodyOffset + index, `unexpected MDX closing tag </${closing![1]!}>`);
      if (open!.name !== closing![1]!) {
        fail(bodyOffset + index, `MDX closing tag </${closing![1]!}> does not match open element <${open!.name}>`);
      }
      flush();
      stack.pop();
      index += closing![0]!.length;
      continue;
    }
    const nameMatch = MDX_TAG_NAME.exec(body.slice(index + 1));
    if (nameMatch === null) {
      append(character, index);
      index += 1;
      continue;
    }
    const start = index;
    const name = nameMatch[0]!;
    const props = Object.create(null) as Record<string, MdxPropValue>;
    let cursor = index + 1 + name.length;
    let selfClosing = false;
    for (;;) {
      while (cursor < body.length && /\s/.test(body[cursor]!)) cursor += 1;
      if (cursor >= body.length) fail(bodyOffset + start, `unterminated MDX tag <${name}>`);
      const next = body[cursor]!;
      if (next === ">") {
        cursor += 1;
        break;
      }
      if (next === "/") {
        if (body[cursor + 1] !== ">") fail(bodyOffset + cursor, `expected '/>' to close <${name}>`);
        selfClosing = true;
        cursor += 2;
        break;
      }
      const attribute = MDX_ATTRIBUTE_NAME.exec(body.slice(cursor));
      if (attribute === null) fail(bodyOffset + cursor, `invalid attribute in <${name}>`);
      const attributeName = attribute![0]!;
      const attributeOffset = cursor;
      if (Object.hasOwn(props, attributeName)) {
        fail(bodyOffset + attributeOffset, `duplicate attribute '${attributeName}' on <${name}>`);
      }
      cursor += attributeName.length;
      let probe = cursor;
      while (probe < body.length && /[ \t]/.test(body[probe]!)) probe += 1;
      if (body[probe] !== "=") {
        props[attributeName] = true;
        continue;
      }
      cursor = probe + 1;
      while (cursor < body.length && /[ \t]/.test(body[cursor]!)) cursor += 1;
      const quote = body[cursor];
      if (quote === '"' || quote === "'") {
        const end = body.indexOf(quote, cursor + 1);
        if (end < 0) fail(bodyOffset + cursor, `unterminated value for attribute '${attributeName}'`);
        props[attributeName] = body.slice(cursor + 1, end);
        cursor = end + 1;
        continue;
      }
      if (quote === "{") {
        const end = body.indexOf("}", cursor + 1);
        if (end < 0) fail(bodyOffset + cursor, `unterminated value for attribute '${attributeName}'`);
        const literal = body.slice(cursor + 1, end).trim();
        if (literal === "true" || literal === "false") props[attributeName] = literal === "true";
        else if (YAML_NUMBER.test(literal)) props[attributeName] = Number(literal);
        else {
          fail(
            bodyOffset + cursor,
            `attribute '${attributeName}' must be a literal value; MDX attributes are never evaluated at comptime`,
          );
        }
        cursor = end + 1;
        continue;
      }
      fail(bodyOffset + cursor, `attribute '${attributeName}' requires a quoted or literal value`);
    }
    flush();
    admit(start);
    const element: ParsedElement = { kind: "element", name, props, children: [], offset: bodyOffset + start };
    children().push(element);
    if (!selfClosing) {
      if (stack.length >= MAX_MDX_DEPTH) fail(bodyOffset + start, `MDX elements nest deeper than ${MAX_MDX_DEPTH}`);
      stack.push({ name, offset: bodyOffset + start, children: element.children });
    }
    index = cursor;
  }
  flush();
  const unclosed = stack[stack.length - 1];
  if (unclosed !== undefined) fail(unclosed.offset, `unclosed MDX element <${unclosed.name}>`);
  return root;
}

const publicMdxNode = (node: ParsedNode): StableJson => {
  if (node.kind === "text") return { kind: "text", value: node.value };
  if (node.kind === "expression") return { kind: "expression", placeholder: node.placeholder };
  return {
    kind: "element",
    name: node.name,
    props: stableClone(node.props),
    children: node.children.map(publicMdxNode),
  };
};

function emitMdxNodes(emitter: GeneratedEmitter, nodes: readonly ParsedNode[], depth: number): void {
  if (nodes.length === 0) {
    emitter.write("[]");
    return;
  }
  emitter.write("[\n");
  for (const node of nodes) {
    emitter.write(indentation(depth + 1));
    emitter.mark(node.offset);
    if (node.kind === "text") emitter.write(`{ ["kind"]: "text", ["value"]: ${JSON.stringify(node.value)} },\n`);
    else if (node.kind === "expression") {
      emitter.write(`{ ["kind"]: "expression", ["placeholder"]: ${JSON.stringify(node.placeholder)} },\n`);
    } else {
      emitter.write(`{ ["kind"]: "element", ["name"]: ${JSON.stringify(node.name)}, ["props"]: ${dataLiteral(node.props)}, ["children"]: `);
      emitMdxNodes(emitter, node.children, depth + 1);
      emitter.write(" },\n");
    }
  }
  emitter.write(`${indentation(depth)}]`);
}

function collectMdx(nodes: readonly ParsedNode[], components: string[], expressions: string[]): void {
  for (const node of nodes) {
    if (node.kind === "expression") expressions.push(node.placeholder);
    if (node.kind !== "element") continue;
    if (/^[A-Z]/.test(node.name) && !components.includes(node.name)) components.push(node.name);
    collectMdx(node.children, components, expressions);
  }
}

export const mdxLoader: AssetLoader = {
  id: "smithers:builtin/mdx",
  version: "2",
  implementationDigest: "builtin-mdx-poc-v2",
  extensions: [".mdx"],
  types: ["mdx"],
  load(asset) {
    const source = asset.text();
    const parsed = parseFrontmatter(source, asset.path);
    const tree = parseMdx(parsed.body, parsed.bodyOffset, source, asset.path);
    const components: string[] = [];
    const expressions: string[] = [];
    collectMdx(tree, components, expressions);
    const emitter = new GeneratedEmitter();
    emitter.mark(0);
    emitter.write(`export const frontmatter = ${dataLiteral(parsed.frontmatter)} as const;\n`);
    emitter.write(`export const source = ${JSON.stringify(source)};\n`);
    emitter.write(`export const body = ${JSON.stringify(parsed.body)};\n`);
    emitter.write(`export const components = ${dataLiteral(components)} as const;\n`);
    emitter.write(`export const expressions = ${dataLiteral(expressions)} as const;\n`);
    emitter.write("export const tree = ");
    emitMdxNodes(emitter, tree, 0);
    emitter.write(" as const;\nexport default tree;\n");
    return {
      format: "mdx",
      value: {
        source,
        body: parsed.body,
        bodyOffset: parsed.bodyOffset,
        frontmatter: parsed.frontmatter,
        components,
        expressions,
        tree: tree.map(publicMdxNode),
      },
      emittedTypeScript: emitter.toString(),
      declaration: [
        'export declare const frontmatter: typeof import("./asset.generated.ts").frontmatter;',
        "export declare const source: string;",
        "export declare const body: string;",
        'export declare const components: typeof import("./asset.generated.ts").components;',
        'export declare const expressions: typeof import("./asset.generated.ts").expressions;',
        'export declare const tree: typeof import("./asset.generated.ts").tree;',
        "export default tree;",
        "",
      ].join("\n"),
      diagnostics: [],
      spans: emitter.spans,
    };
  },
};
