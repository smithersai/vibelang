import { readFileSync, realpathSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AssetBuild, AssetCompiler, AssetDependency, LoaderContext } from "./assets.ts";
import { assertSandboxedComptimeModule, type SandboxedComptimeModule } from "./sandboxed-loader.ts";
import {
  canonical,
  compareStableStrings,
  digest,
  freezeStable,
  stableClone,
  type StableJson,
} from "./stable.ts";

export interface ComptimeCompilerOptions {
  readonly root: string;
  readonly cacheDirectory: string;
  readonly assets?: AssetCompiler;
  readonly target?: string;
  readonly options?: Record<string, unknown>;
}

export interface ComptimeBuild<T extends StableJson = StableJson> {
  readonly key: string;
  readonly logicalKey: string;
  readonly module: string;
  readonly cacheHit: boolean;
  readonly dependencies: readonly AssetDependency[];
  readonly value: T;
}

export interface StaticComptimeOptions {
  /** Stable frontend identity (normally source digest plus call span). */
  readonly identity: unknown;
  /** Compiler-owned inputs observed while statically evaluating the call. */
  readonly dependencies?: readonly AssetDependency[];
}

export interface TrackedComptimeText {
  readonly value: string;
  readonly dependency: AssetDependency;
}

interface ComptimeIndex {
  readonly key: string;
  readonly dependencies: readonly AssetDependency[];
}

interface ComptimeEnvelope {
  readonly build: Omit<ComptimeBuild, "cacheHit">;
  readonly outputDigest: string;
}

/**
 * Content-addressed hermetic evaluator used after the frontend resolves the
 * compiler-owned `comptime` binding and extracts a checked callable artifact.
 */
export class ComptimeCompiler {
  readonly root: string;
  readonly cacheDirectory: string;
  readonly target: string;
  readonly options: Readonly<Record<string, unknown>>;
  readonly assets?: AssetCompiler;
  readonly #inflight = new Map<string, Promise<ComptimeBuild>>();

  constructor(options: ComptimeCompilerOptions) {
    this.root = realpathSync(resolve(options.root));
    if (!statSync(this.root).isDirectory()) throw new Error("comptime compiler root must be a directory");
    this.cacheDirectory = resolve(options.cacheDirectory);
    this.target = options.target ?? "typescript-node";
    const snapshot = stableClone(options.options ?? {}, "comptime compiler options");
    if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== "object") {
      throw new TypeError("comptime compiler options must be a JSON object");
    }
    this.options = freezeStable(snapshot) as Readonly<Record<string, unknown>>;
    this.assets = options.assets;
    if (this.assets && this.assets.root !== this.root) {
      throw new Error("comptime and asset compilers must share the same canonical project root");
    }
    if (this.assets && this.assets.target !== this.target) {
      throw new Error("comptime and asset compilers must target the same platform");
    }
  }

  async evaluate<T extends StableJson = StableJson>(
    module: SandboxedComptimeModule,
    args: readonly StableJson[] = [],
    options: { readonly from?: string } = {},
  ): Promise<ComptimeBuild<T>> {
    assertSandboxedComptimeModule(module);
    const argumentSnapshot = freezeStable(stableClone(args, "comptime arguments"));
    const from = this.#resolveDirectory(options.from ?? this.#defaultFrom(module.sourcePath));
    const identity = {
      compiler: "vibelang-comptime-poc@3",
      module: module.id,
      moduleVersion: module.version,
      implementationDigest: module.implementationDigest,
      target: this.target,
      options: this.options,
      args: argumentSnapshot,
      from: relative(this.root, from).split(sep).join("/"),
    };
    const logicalKey = digest(identity);
    const existing = this.#inflight.get(logicalKey);
    if (existing) return existing as Promise<ComptimeBuild<T>>;
    const pending = this.#evaluate<T>(module, argumentSnapshot as readonly StableJson[], from, identity, logicalKey);
    this.#inflight.set(logicalKey, pending as Promise<ComptimeBuild>);
    try {
      return await pending;
    } finally {
      if (this.#inflight.get(logicalKey) === pending) this.#inflight.delete(logicalKey);
    }
  }

  /**
   * Records a frontend-proven static value in the same content-addressed
   * comptime cache without invoking a sandbox module. The frontend must only
   * call this after it has resolved the compiler-owned intrinsic and decoded
   * its argument from syntax.
   */
  async evaluateStatic<T extends StableJson = StableJson>(
    value: unknown,
    options: StaticComptimeOptions,
  ): Promise<ComptimeBuild<T>> {
    const valueSnapshot = freezeStable(stableClone(value, "static comptime result")) as T;
    const frontendIdentity = freezeStable(stableClone(options.identity, "static comptime identity"));
    const dependencies = normalizeStaticDependencies(options.dependencies ?? []);
    this.#assertStaticDependencySnapshots(dependencies);
    const identity = {
      compiler: "vibelang-comptime-static@2",
      module: "vibelang:comptime/static-json",
      target: this.target,
      options: this.options,
      frontendIdentity,
      value: valueSnapshot,
    };
    const logicalKey = digest(identity);
    const inflightKey = digest({ logicalKey, dependencies });
    const existing = this.#inflight.get(inflightKey);
    if (existing) return existing as Promise<ComptimeBuild<T>>;
    const pending = this.#evaluateStatic<T>(valueSnapshot, dependencies, identity, logicalKey);
    this.#inflight.set(inflightKey, pending as Promise<ComptimeBuild>);
    try {
      return await pending;
    } finally {
      if (this.#inflight.get(inflightKey) === pending) this.#inflight.delete(inflightKey);
    }
  }

  /**
   * Resolve and snapshot a text input through compiler-owned project authority.
   * The caller must attach the returned dependency to `evaluateStatic`.
   */
  readTrackedText(specifier: string, options: { readonly from: string }): TrackedComptimeText {
    const fromFile = this.#resolveFile(options.from, this.root);
    const path = this.#resolveFile(specifier, dirname(fromFile));
    const value = readFileSync(path, "utf8");
    return Object.freeze({
      value,
      dependency: Object.freeze({
        path: relative(this.root, path).split(sep).join("/"),
        digest: digest(value),
        kind: "file" as const,
        access: "text" as const,
      }),
    });
  }

  async #evaluateStatic<T extends StableJson>(
    value: T,
    dependencies: readonly AssetDependency[],
    identity: Record<string, unknown>,
    logicalKey: string,
  ): Promise<ComptimeBuild<T>> {
    const module = "vibelang:comptime/static-json";
    const indexPath = join(this.cacheDirectory, "comptime-static-index", `${logicalKey}.json`);
    const previous = await readJson<ComptimeIndex>(indexPath);
    if (validIndex(previous) && canonical(previous.dependencies) === canonical(dependencies) &&
      await this.#dependenciesStillMatch(previous.dependencies)) {
      const envelope = await readJson<ComptimeEnvelope>(
        join(this.cacheDirectory, "comptime-objects", `${previous.key}.json`),
      );
      const restored = restoreEnvelope<T>(envelope, previous.key, logicalKey, module, dependencies, identity);
      if (restored) return restored;
    }

    const key = digest({ ...identity, dependencies, value });
    const build: Omit<ComptimeBuild<T>, "cacheHit"> = {
      key,
      logicalKey,
      module,
      dependencies,
      value,
    };
    await writeJsonAtomic(join(this.cacheDirectory, "comptime-objects", `${key}.json`), {
      build,
      outputDigest: digest(build),
    } satisfies ComptimeEnvelope);
    await writeJsonAtomic(indexPath, { key, dependencies } satisfies ComptimeIndex);
    return Object.freeze({ ...build, cacheHit: false });
  }

  async #evaluate<T extends StableJson>(
    module: SandboxedComptimeModule,
    args: readonly StableJson[],
    from: string,
    identity: Record<string, unknown>,
    logicalKey: string,
  ): Promise<ComptimeBuild<T>> {
    const indexPath = join(this.cacheDirectory, "comptime-index", `${logicalKey}.json`);
    const previous = await readJson<ComptimeIndex>(indexPath);
    if (validIndex(previous) && await this.#dependenciesStillMatch(previous.dependencies)) {
      const envelope = await readJson<ComptimeEnvelope>(
        join(this.cacheDirectory, "comptime-objects", `${previous.key}.json`),
      );
      const restored = restoreEnvelope<T>(envelope, previous.key, logicalKey, module.id, previous.dependencies, identity);
      if (restored) return restored;
    }

    const dependencies = new Map<string, AssetDependency>();
    const context: LoaderContext = Object.freeze({
      target: this.target,
      options: this.options,
      readText: async (specifier: string): Promise<string> => {
        const path = this.#resolveFile(specifier, from);
        const text = await readFile(path, "utf8");
        dependencies.set(`${path}\0text`, {
          path: relative(this.root, path).split(sep).join("/"),
          digest: digest(text),
          kind: "file",
          access: "text",
        });
        return text;
      },
      readBytes: async (specifier: string): Promise<Uint8Array> => {
        const path = this.#resolveFile(specifier, from);
        const bytes = new Uint8Array(await readFile(path));
        dependencies.set(`${path}\0bytes`, {
          path: relative(this.root, path).split(sep).join("/"),
          digest: digest(Buffer.from(bytes).toString("base64")),
          kind: "file",
          access: "bytes",
        });
        return bytes;
      },
      import: async (specifier: string, importOptions: Record<string, unknown> = {}) => {
        if (!this.assets) throw new Error("comptime asset import requires an AssetCompiler");
        const path = this.#resolveFile(specifier, from);
        const child = await this.assets.compile(relative(this.root, path), importOptions);
        dependencies.set(`${path}\0asset:${child.logicalKey}`, {
          path: child.path,
          digest: child.key,
          kind: "asset",
          logicalKey: child.logicalKey,
        });
        const { cacheHit: _cacheHit, ...deterministic } = child;
        return deterministic;
      },
    });

    const value = freezeStable(await module.evaluate(args, context)) as T;
    if (dependencies.size > 10_000) throw new Error("comptime evaluation declared more than 10000 dependencies");
    const dependencyList = Object.freeze([...dependencies.values()]
      .sort((left, right) => compareStableStrings(left.path, right.path) || compareStableStrings(canonical(left), canonical(right)))
      .map((dependency) => Object.freeze({ ...dependency })));
    const key = digest({ ...identity, dependencies: dependencyList, value });
    const build: Omit<ComptimeBuild<T>, "cacheHit"> = {
      key,
      logicalKey,
      module: module.id,
      dependencies: dependencyList,
      value,
    };
    await writeJsonAtomic(join(this.cacheDirectory, "comptime-objects", `${key}.json`), {
      build,
      outputDigest: digest(build),
    } satisfies ComptimeEnvelope);
    await writeJsonAtomic(indexPath, { key, dependencies: dependencyList } satisfies ComptimeIndex);
    return Object.freeze({ ...build, cacheHit: false });
  }

  async #dependenciesStillMatch(dependencies: readonly AssetDependency[]): Promise<boolean> {
    for (const dependency of dependencies) {
      try {
        const path = this.#resolveFile(dependency.path, this.root);
        if (dependency.kind === "asset") {
          if (!this.assets) return false;
          if (!await this.assets.isDependencyCurrent(dependency)) return false;
          continue;
        }
        const bytes = new Uint8Array(await readFile(path));
        const current = dependency.access === "text"
          ? digest(new TextDecoder().decode(bytes))
          : digest(Buffer.from(bytes).toString("base64"));
        if (dependency.digest !== current) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  #assertStaticDependencySnapshots(dependencies: readonly AssetDependency[]): void {
    for (const dependency of dependencies) {
      const path = this.#resolveFile(dependency.path, this.root);
      const bytes = readFileSync(path);
      const current = dependency.access === "text"
        ? digest(new TextDecoder().decode(bytes))
        : digest(bytes.toString("base64"));
      if (current !== dependency.digest) {
        throw new Error(`static comptime dependency changed after it was read: ${dependency.path}`);
      }
    }
  }

  #defaultFrom(modulePath: string): string {
    // Authentic sandbox modules expose the canonical path snapshotted when
    // they were created. Do not require that source file to remain live after
    // its code and implementation digest have been captured.
    const directory = dirname(modulePath);
    const back = relative(this.root, directory);
    return back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back) ? this.root : directory;
  }

  #resolveDirectory(specifier: string): string {
    const path = isAbsolute(specifier) ? realpathSync(specifier) : realpathSync(resolve(this.root, specifier));
    this.#assertInsideRoot(path, specifier);
    if (!statSync(path).isDirectory()) throw new Error(`comptime base must be a directory: ${specifier}`);
    return path;
  }

  #resolveFile(specifier: string, from: string): string {
    if (isAbsolute(specifier)) throw new Error(`comptime inputs must be relative: ${specifier}`);
    const path = realpathSync(resolve(from, specifier));
    this.#assertInsideRoot(path, specifier);
    if (!statSync(path).isFile()) throw new Error(`comptime input must be a regular file: ${specifier}`);
    return path;
  }

  #assertInsideRoot(path: string, specifier: string): void {
    const back = relative(this.root, path);
    if (back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) {
      throw new Error(`comptime input escaped project root: ${specifier}`);
    }
  }
}

function normalizeStaticDependencies(dependencies: readonly AssetDependency[]): readonly AssetDependency[] {
  if (dependencies.length > 10_000) throw new Error("comptime evaluation declared more than 10000 dependencies");
  const byIdentity = new Map<string, AssetDependency>();
  for (const dependency of dependencies) {
    const cloned = stableClone(dependency, "static comptime dependency") as unknown as AssetDependency;
    if (cloned.kind !== "file" || (cloned.access !== "text" && cloned.access !== "bytes") ||
      typeof cloned.path !== "string" || cloned.path.length === 0 || typeof cloned.digest !== "string") {
      throw new TypeError("static comptime dependencies must be compiler-owned file snapshots");
    }
    const identity = `${cloned.path}\0${cloned.access}`;
    const previous = byIdentity.get(identity);
    if (previous && previous.digest !== cloned.digest) {
      throw new TypeError(`static comptime dependency ${JSON.stringify(cloned.path)} has conflicting snapshots`);
    }
    byIdentity.set(identity, Object.freeze(cloned));
  }
  return Object.freeze([...byIdentity.values()].sort((left, right) =>
    compareStableStrings(left.path, right.path) || compareStableStrings(canonical(left), canonical(right))));
}

function validIndex(value: ComptimeIndex | undefined): value is ComptimeIndex {
  return value !== undefined && /^[0-9a-f]{64}$/.test(value.key) &&
    Array.isArray(value.dependencies) && value.dependencies.length <= 10_000 && value.dependencies.every((dependency) =>
      dependency !== null && typeof dependency === "object" &&
      typeof dependency.path === "string" && /^[0-9a-f]{64}$/.test(dependency.digest) &&
      ((dependency.kind === "file" && (dependency.access === "text" || dependency.access === "bytes")) ||
        (dependency.kind === "asset" && typeof dependency.logicalKey === "string" && /^[0-9a-f]{64}$/.test(dependency.logicalKey))));
}

function restoreEnvelope<T extends StableJson>(
  envelope: ComptimeEnvelope | undefined,
  key: string,
  logicalKey: string,
  module: string,
  dependencies: readonly AssetDependency[],
  identity: Record<string, unknown>,
): ComptimeBuild<T> | undefined {
  if (!envelope || typeof envelope.outputDigest !== "string") return undefined;
  try {
    if (digest(envelope.build) !== envelope.outputDigest) return undefined;
    const build = stableClone(envelope.build, "cached comptime build") as unknown as Omit<ComptimeBuild<T>, "cacheHit">;
    if (
      build.key !== key || build.logicalKey !== logicalKey || build.module !== module ||
      canonical(build.dependencies) !== canonical(dependencies) ||
      digest({ ...identity, dependencies: build.dependencies, value: build.value }) !== key
    ) return undefined;
    const cachedDependencies = freezeStable(build.dependencies as unknown as StableJson) as unknown as readonly AssetDependency[];
    return Object.freeze({ ...build, dependencies: cachedDependencies, value: freezeStable(build.value), cacheHit: true });
  } catch {
    return undefined;
  }
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${canonical(value)}\n`);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
