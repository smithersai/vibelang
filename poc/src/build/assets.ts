import { realpathSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import * as ts from "typescript-js";
import { canonical, digest, freezeStable, stableClone, type StableJson } from "./stable.ts";

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
  path: string;
  digest: string;
}

export interface AssetBuild {
  path: string;
  key: string;
  loader: string;
  cacheHit: boolean;
  dependencies: AssetDependency[];
  module: TypedAssetModule;
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
  import(specifier: string, options?: Record<string, unknown>): Promise<AssetBuild>;
}

export interface AssetLoader {
  /** Stable package-qualified identity. Never use Function#toString as an identity. */
  id: string;
  version: string;
  /** Digest of the loader artifact together with its locked dependencies. */
  implementationDigest: string;
  extensions: readonly string[];
  load(asset: LoaderAsset, context: LoaderContext): Promise<TypedAssetModule> | TypedAssetModule;
}

interface CacheIndexEntry {
  sourceDigest: string;
  dependencies: AssetDependency[];
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
}

export class AssetCompiler {
  readonly root: string;
  readonly cacheDirectory: string;
  readonly target: string;
  readonly options: Readonly<Record<string, unknown>>;
  readonly #loaders = new Map<string, AssetLoader>();

  constructor(options: AssetCompilerOptions) {
    this.root = realpathSync(resolve(options.root));
    this.cacheDirectory = resolve(options.cacheDirectory);
    this.target = options.target ?? "typescript-node";
    const globalOptions = stableClone(options.options ?? {}, "asset compiler options");
    if (globalOptions === null || Array.isArray(globalOptions) || typeof globalOptions !== "object") {
      throw new TypeError("asset compiler options must be a JSON object");
    }
    this.options = freezeStable(globalOptions) as Readonly<Record<string, unknown>>;
    this.register(jsonLoader, markdownLoader, mdxLoader);
  }

  register(...loaders: AssetLoader[]): this {
    for (const loader of loaders) {
      if (!loader.implementationDigest.trim()) {
        throw new Error(`loader ${loader.id} must pin an implementation digest`);
      }
      for (const extension of loader.extensions) {
        if (!extension.startsWith(".")) throw new Error(`loader extension must start with '.': ${extension}`);
        const existing = this.#loaders.get(extension);
        if (existing) throw new Error(`loader conflict for ${extension}: ${existing.id} and ${loader.id}`);
        this.#loaders.set(extension, loader);
      }
    }
    return this;
  }

  async compile(specifier: string, localOptions: Record<string, unknown> = {}): Promise<AssetBuild> {
    const optionSnapshot = snapshotOptions(localOptions, "asset import options");
    const path = this.#resolveInsideRoot(specifier, this.root);
    return this.#compilePath(path, optionSnapshot, []);
  }

  async #compilePath(
    path: string,
    localOptions: Readonly<Record<string, unknown>>,
    stack: readonly string[],
  ): Promise<AssetBuild> {
    // Snapshot before the first await so caller mutation cannot change output
    // under an already-computed logical/content key.
    const optionSnapshot = snapshotOptions(localOptions, "asset import options");
    if (stack.includes(path)) throw new Error(`asset cycle: ${[...stack, path].map((x) => relative(this.root, x)).join(" -> ")}`);
    const loader = this.#loaders.get(extname(path));
    if (!loader) throw new Error(`no comptime loader registered for ${extname(path) || path}`);

    const bytes = new Uint8Array(await readFile(path));
    const sourceDigest = digest(bytesToStableString(bytes));
    const identity = {
      compiler: "vibelang-poc-1",
      loader: loader.id,
      loaderVersion: loader.version,
      loaderImplementation: loader.implementationDigest,
      target: this.target,
      options: this.options,
      localOptions: optionSnapshot,
      path: relative(this.root, path),
    };
    const logicalKey = digest(identity);
    const indexPath = join(this.cacheDirectory, "index", `${logicalKey}.json`);
    const previous = await readJson<CacheIndexEntry>(indexPath);
    if (validCacheIndex(previous, sourceDigest) && await dependenciesStillMatch(previous.dependencies, this.root)) {
      const cached = await readJson<CacheEnvelope>(join(this.cacheDirectory, "objects", `${previous.key}.json`));
      const restored = restoreCachedBuild(cached, {
        key: previous.key,
        path: relative(this.root, path),
        loader: `${loader.id}@${loader.version}`,
        dependencies: previous.dependencies,
        sourcePath: path,
        sourceBytes: bytes.length,
      });
      if (restored) return restored;
    }

    const dependencies = new Map<string, string>();
    const resolveDependency = (specifier: string) => this.#resolveInsideRoot(specifier, dirname(path));
    const context: LoaderContext = {
      target: this.target,
      options: snapshotOptions({ ...this.options, ...optionSnapshot }, "merged asset options"),
      readText: async (specifier) => {
        const dependencyPath = resolveDependency(specifier);
        const text = await readFile(dependencyPath, "utf8");
        dependencies.set(dependencyPath, digest(text));
        return text;
      },
      readBytes: async (specifier) => {
        const dependencyPath = resolveDependency(specifier);
        const dependencyBytes = new Uint8Array(await readFile(dependencyPath));
        dependencies.set(dependencyPath, digest(bytesToStableString(dependencyBytes)));
        return dependencyBytes;
      },
      import: async (specifier, importOptions = {}) => {
        const dependencyPath = resolveDependency(specifier);
        const child = await this.#compilePath(dependencyPath, importOptions, [...stack, path]);
        dependencies.set(dependencyPath, child.key);
        for (const dependency of child.dependencies) {
          dependencies.set(resolve(this.root, dependency.path), dependency.digest);
        }
        return child;
      },
    };

    const asset: LoaderAsset = {
      path,
      bytes,
      text: () => new TextDecoder().decode(bytes),
    };
    const module = normalizeLoaderModule(await loader.load(asset, context), path, bytes.length);
    const dependencyList = [...dependencies].map(([dependencyPath, dependencyDigest]) => ({
      path: relative(this.root, dependencyPath),
      digest: dependencyDigest,
    })).sort((a, b) => a.path.localeCompare(b.path));
    const key = digest({ ...identity, sourceDigest, dependencies: dependencyList });
    const build: Omit<AssetBuild, "cacheHit"> = {
      path: relative(this.root, path),
      key,
      loader: `${loader.id}@${loader.version}`,
      dependencies: dependencyList,
      module,
    };
    await writeJsonAtomic(join(this.cacheDirectory, "objects", `${key}.json`), {
      build,
      outputDigest: digest(build),
    } satisfies CacheEnvelope);
    await writeJsonAtomic(indexPath, { sourceDigest, dependencies: dependencyList, key } satisfies CacheIndexEntry);
    return { ...build, cacheHit: false };
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

function validCacheIndex(entry: CacheIndexEntry | undefined, sourceDigest: string): entry is CacheIndexEntry {
  return entry !== undefined &&
    entry.sourceDigest === sourceDigest &&
    /^[0-9a-f]{64}$/.test(entry.key) &&
    Array.isArray(entry.dependencies) &&
    entry.dependencies.every((dependency) =>
      dependency !== null && typeof dependency === "object" &&
      typeof dependency.path === "string" && typeof dependency.digest === "string");
}

function restoreCachedBuild(
  envelope: CacheEnvelope | undefined,
  expected: {
    key: string;
    path: string;
    loader: string;
    dependencies: readonly AssetDependency[];
    sourcePath: string;
    sourceBytes: number;
  },
): AssetBuild | undefined {
  if (!envelope || typeof envelope.outputDigest !== "string") return undefined;
  try {
    if (digest(envelope.build) !== envelope.outputDigest) return undefined;
    const build = stableClone(envelope.build, "cached asset build") as unknown as Omit<AssetBuild, "cacheHit">;
    if (
      build.key !== expected.key || build.path !== expected.path || build.loader !== expected.loader ||
      canonical(build.dependencies) !== canonical(expected.dependencies)
    ) return undefined;
    const module = normalizeLoaderModule(build.module, expected.sourcePath, expected.sourceBytes);
    return {
      path: build.path,
      key: build.key,
      loader: build.loader,
      dependencies: build.dependencies,
      module,
      cacheHit: true,
    };
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
      (diagnostic.offset !== undefined && !Number.isSafeInteger(diagnostic.offset))
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
  return module;
}

function bytesToStableString(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function dependenciesStillMatch(
  dependencies: readonly AssetDependency[],
  root: string,
): Promise<boolean> {
  for (const dependency of dependencies) {
    try {
      const dependencyPath = realpathSync(resolve(root, dependency.path));
      const back = relative(root, dependencyPath);
      if (back === ".." || back.startsWith(`..${sep}`) || isAbsolute(back)) return false;
      const bytes = new Uint8Array(await readFile(dependencyPath));
      const rawDigest = digest(bytesToStableString(bytes));
      const textDigest = digest(new TextDecoder().decode(bytes));
      // Direct text/byte reads use a raw digest. Nested imports use a graph key and
      // intentionally force one loader pass in this small POC.
      if (dependency.digest !== rawDigest && dependency.digest !== textDigest) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${canonical(value)}\n`);
  await rename(temporary, path);
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
  id: "vibelang:builtin/json",
  version: "1",
  implementationDigest: "builtin-json-poc-v1",
  extensions: [".json"],
  load(asset) {
    const source = asset.text();
    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch (error) {
      throw new SyntaxError(`${relative(process.cwd(), asset.path)}: ${(error as Error).message}`);
    }
    const literal = constLiteral(stableClone(value));
    return {
      format: "json-const",
      value,
      emittedTypeScript: `const value = ${literal} as const;\nexport default value;\n`,
      declaration: "declare const value: typeof import(\"./asset.generated.ts\").default;\nexport default value;\n",
      diagnostics: [],
      spans: [{ generatedOffset: 14, sourceOffset: 0 }],
    };
  },
};

function parseFrontmatter(source: string): { frontmatter: Record<string, string>; body: string } {
  if (!source.startsWith("---\n")) return { frontmatter: {}, body: source };
  const end = source.indexOf("\n---\n", 4);
  if (end < 0) return { frontmatter: {}, body: source };
  const frontmatter = Object.create(null) as Record<string, string>;
  for (const line of source.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) frontmatter[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return { frontmatter, body: source.slice(end + 5) };
}

export const markdownLoader: AssetLoader = {
  id: "vibelang:builtin/markdown",
  version: "1",
  implementationDigest: "builtin-markdown-poc-v1",
  extensions: [".md"],
  load(asset) {
    const source = asset.text();
    const parsed = parseFrontmatter(source);
    const value = { source, ...parsed };
    return {
      format: "markdown",
      value,
      emittedTypeScript: `export const frontmatter = ${constLiteral(stableClone(parsed.frontmatter))} as const;\nexport const source = ${JSON.stringify(source)};\nexport default source;\n`,
      declaration: "export declare const frontmatter: Readonly<Record<string, string>>;\nexport declare const source: string;\nexport default source;\n",
      diagnostics: [],
      spans: [{ generatedOffset: 0, sourceOffset: 0 }],
    };
  },
};

export const mdxLoader: AssetLoader = {
  id: "vibelang:builtin/mdx",
  version: "1",
  implementationDigest: "builtin-mdx-poc-v1",
  extensions: [".mdx"],
  load(asset) {
    const source = asset.text();
    const parsed = parseFrontmatter(source);
    const components = [...new Set([...parsed.body.matchAll(/<([A-Z][A-Za-z0-9.]*)\b/g)].map((match) => match[1]))];
    const expressions = [...parsed.body.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1].trim());
    const value = { source, body: parsed.body, frontmatter: parsed.frontmatter, components, expressions };
    return {
      format: "mdx",
      value,
      emittedTypeScript: `export const source = ${JSON.stringify(source)};\nexport const components = ${constLiteral(stableClone(components))} as const;\nexport default source;\n`,
      declaration: "export declare const source: string;\nexport declare const components: readonly string[];\nexport default source;\n",
      diagnostics: [],
      spans: [{ generatedOffset: 0, sourceOffset: 0 }],
    };
  },
};
