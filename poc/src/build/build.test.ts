import { afterAll, describe, expect, test } from "bun:test";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AssetCompiler,
  AssetSourceError,
  ComptimeCompiler,
  type AssetLoader,
  ValidationFailure,
  canonical,
  compareStableStrings,
  compileSourceAssetModules,
  createSandboxedLoader,
  createSandboxedComptimeModule,
  deriveSchema,
  digest,
  parseWithSchema,
  stableClone,
} from "./index.ts";
import { catchFailure, isVibeFailure } from "../runtime/failure.ts";
import { mdxPrompt } from "../agent/prompt.ts";

const roots: string[] = [];
const inProcessCompiler = (options: ConstructorParameters<typeof AssetCompiler>[0]) =>
  new AssetCompiler({ ...options, unsafeAllowInProcessLoadersForTests: true });
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

describe("comptime assets and derived schemas", () => {
  test("third-party registration requires an authentic sandbox loader by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-loader-authenticity-"));
    roots.push(root);
    const forged: AssetLoader = {
      id: "test:forged",
      version: "1",
      implementationDigest: "forged-loader-v1",
      extensions: [".forged"],
      load() { throw new Error("forged loader ran"); },
    };
    expect(() => new AssetCompiler({ root, cacheDirectory: join(root, ".cache") }).register(forged))
      .toThrow("createSandboxedLoader");
    expect(() => new AssetCompiler({
      root,
      cacheDirectory: join(root, ".cache"),
      unsafeAllowInProcessLoadersForTests: "yes" as unknown as boolean,
    })).toThrow("must be boolean");
  });

  test("content keys include tracked dependencies and unchanged work hits cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-assets-"));
    roots.push(root);
    await writeFile(join(root, "data.kv"), "answer=42\n");
    await writeFile(join(root, "shape.txt"), "answer\n");
    const loader: AssetLoader = {
      id: "test:kv",
      version: "1",
      implementationDigest: "kv-loader-code-v1",
      extensions: [".kv"],
      async load(asset, context) {
        const required = (await context.readText("./shape.txt")).trim();
        const value = Object.fromEntries(asset.text().trim().split("\n").map((line) => line.split("=")));
        if (!(required in value)) throw new Error(`missing ${required}`);
        return {
          format: "kv", value,
          emittedTypeScript: `export default ${JSON.stringify(value)} as const`,
          declaration: "declare const value: Readonly<Record<string, string>>; export default value",
          diagnostics: [], spans: [],
        };
      },
    };
    const compiler = inProcessCompiler({ root, cacheDirectory: join(root, ".cache") }).register(loader);
    const first = await compiler.compile("data.kv");
    const second = await compiler.compile("data.kv");
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.key).toBe(first.key);
    expect(second.dependencies).toHaveLength(1);
    expect(Object.isFrozen(second.dependencies)).toBe(true);
    expect(Object.isFrozen(second.dependencies[0])).toBe(true);

    await writeFile(join(root, "shape.txt"), "other\n");
    await expect(compiler.compile("data.kv")).rejects.toThrow("missing other");
  });

  test("one asset build snapshots transitive bytes once and invalidates that snapshot on the next build", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-asset-snapshot-"));
    roots.push(root);
    await writeFile(join(root, "main.snapshot"), "main");
    await writeFile(join(root, "dependency.txt"), "first");
    let calls = 0;
    const loader: AssetLoader = {
      id: "test:graph-snapshot",
      version: "1",
      implementationDigest: "graph-snapshot-v1",
      extensions: [".snapshot"],
      async load(_asset, context) {
        calls += 1;
        const first = await context.readText("./dependency.txt");
        if (calls === 1) await writeFile(join(root, "dependency.txt"), "second");
        const second = await context.readText("./dependency.txt");
        const value = `${first}|${second}`;
        return {
          format: "snapshot",
          value,
          emittedTypeScript: `export default ${JSON.stringify(value)}`,
          declaration: "declare const value: string; export default value",
          diagnostics: [],
          spans: [],
        };
      },
    };
    const compiler = inProcessCompiler({ root, cacheDirectory: join(root, ".cache") }).register(loader);
    expect((await compiler.compile("main.snapshot")).module.value).toBe("first|first");
    expect((await compiler.compile("main.snapshot")).module.value).toBe("second|second");
    expect(calls).toBe(2);
  });

  test("asset source, transitive byte/file budgets, UTF-8, hard-link aliases, and cache authority fail closed", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-asset-bounds-"));
    roots.push(root);
    await writeFile(join(root, "oversized.raw"), "x".repeat(33));
    const rawLoader: AssetLoader = {
      id: "test:raw-limit",
      version: "1",
      implementationDigest: "raw-limit-v1",
      extensions: [".raw"],
      load: (asset) => ({
        format: "raw", value: asset.bytes.length,
        emittedTypeScript: `export default ${asset.bytes.length}`,
        declaration: "declare const value: number; export default value",
        diagnostics: [], spans: [],
      }),
    };
    await expect(inProcessCompiler({
      root,
      cacheDirectory: join(root, ".raw-cache"),
      maximumFileBytes: 32,
      maximumGraphBytes: 64,
    }).register(rawLoader).compile("oversized.raw")).rejects.toThrow("exceeds 32 bytes");

    await writeFile(join(root, "main.graph"), "main");
    await writeFile(join(root, "left.txt"), "l".repeat(20));
    await writeFile(join(root, "right.txt"), "r".repeat(20));
    const graphLoader: AssetLoader = {
      id: "test:graph-limit",
      version: "1",
      implementationDigest: "graph-limit-v1",
      extensions: [".graph"],
      async load(_asset, context) {
        await Promise.all([context.readBytes("./left.txt"), context.readBytes("./right.txt")]);
        return {
          format: "graph", value: true, emittedTypeScript: "export default true",
          declaration: "declare const value: true; export default value", diagnostics: [], spans: [],
        };
      },
    };
    await expect(inProcessCompiler({
      root,
      cacheDirectory: join(root, ".graph-byte-cache"),
      maximumFileBytes: 32,
      maximumGraphBytes: 40,
    }).register(graphLoader).compile("main.graph")).rejects.toThrow("graph exceeds 40 bytes");
    await expect(inProcessCompiler({
      root,
      cacheDirectory: join(root, ".graph-file-cache"),
      maximumFileBytes: 32,
      maximumGraphBytes: 128,
      maximumGraphFiles: 2,
    }).register(graphLoader).compile("main.graph")).rejects.toThrow("graph exceeds 2 files");

    await writeFile(join(root, "invalid.utf8"), new Uint8Array([0xc3, 0x28]));
    const textLoader: AssetLoader = {
      id: "test:utf8-limit", version: "1", implementationDigest: "utf8-limit-v1", extensions: [".utf8"],
      load: (asset) => ({
        format: "text", value: asset.text(), emittedTypeScript: "export default ''",
        declaration: "declare const value: string; export default value", diagnostics: [], spans: [],
      }),
    };
    await expect(inProcessCompiler({ root, cacheDirectory: join(root, ".utf8-cache") })
      .register(textLoader).compile("invalid.utf8")).rejects.toThrow("not valid UTF-8");

    if (process.platform !== "win32") {
      await writeFile(join(root, "alias-a.txt"), "same");
      await link(join(root, "alias-a.txt"), join(root, "alias-b.txt"));
      const aliasLoader: AssetLoader = {
        id: "test:hard-link-limit", version: "1", implementationDigest: "hard-link-limit-v1", extensions: [".aliases"],
        async load(_asset, context) {
          await context.readText("./alias-a.txt");
          await context.readText("./alias-b.txt");
          return {
            format: "aliases", value: true, emittedTypeScript: "export default true",
            declaration: "declare const value: true; export default value", diagnostics: [], spans: [],
          };
        },
      };
      await writeFile(join(root, "main.aliases"), "main");
      await expect(inProcessCompiler({ root, cacheDirectory: join(root, ".alias-cache") })
        .register(aliasLoader).compile("main.aliases")).rejects.toThrow("hard-link aliases are forbidden");
    }

    const cacheDirectory = join(root, ".owned-cache");
    await writeFile(join(root, "cache-reader.graph"), "main");
    const cacheReader: AssetLoader = {
      id: "test:cache-authority", version: "1", implementationDigest: "cache-authority-v1", extensions: [".graph"],
      async load(_asset, context) {
        await context.readText("./.owned-cache/secret.txt");
        return {
          format: "cache", value: true, emittedTypeScript: "export default true",
          declaration: "declare const value: true; export default value", diagnostics: [], spans: [],
        };
      },
    };
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(join(cacheDirectory, "secret.txt"), "ambient");
    const cacheCompiler = inProcessCompiler({ root, cacheDirectory }).register(cacheReader);
    await expect(cacheCompiler.compile("cache-reader.graph"))
      .rejects.toThrow("cannot read compiler-owned cache files");
    expect(await cacheCompiler.isDependencyCurrent({
      path: ".owned-cache/secret.txt",
      digest: digest("ambient"),
      kind: "file",
      access: "text",
    })).toBe(false);

    expect(() => new AssetCompiler({
      root,
      cacheDirectory: join(root, ".invalid-limit-cache"),
      maximumFileBytes: 10,
      maximumGraphBytes: 9,
    })).toThrow("maximumGraphBytes must be at least maximumFileBytes");
  });

  test("cache reads and writes obey the entry budget without changing valid build results", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-asset-cache-bounds-"));
    roots.push(root);
    await writeFile(join(root, "small.cachebound"), "small");
    await writeFile(join(root, "large.cachebound"), "x".repeat(5_000));
    let calls = 0;
    const loader: AssetLoader = {
      id: "test:cache-entry-limit",
      version: "1",
      implementationDigest: "cache-entry-limit-v1",
      extensions: [".cachebound"],
      load(asset) {
        calls += 1;
        const value = asset.text();
        return {
          format: "cachebound",
          value,
          emittedTypeScript: `export default ${JSON.stringify(value)}`,
          declaration: "declare const value: string; export default value",
          diagnostics: [], spans: [],
        };
      },
    };
    const cacheDirectory = join(root, ".cache");
    const compiler = inProcessCompiler({
      root,
      cacheDirectory,
      maximumCacheEntryBytes: 4_096,
    }).register(loader);

    const small = await compiler.compile("small.cachebound");
    expect((await compiler.compile("small.cachebound")).cacheHit).toBe(true);
    const objectPath = join(cacheDirectory, "objects", `${small.key}.json`);
    await writeFile(objectPath, "x".repeat(4_097));
    const rebuilt = await compiler.compile("small.cachebound");
    expect(rebuilt.cacheHit).toBe(false);
    expect(rebuilt.module.value).toBe("small");

    const firstLarge = await compiler.compile("large.cachebound");
    const secondLarge = await compiler.compile("large.cachebound");
    expect(firstLarge.cacheHit).toBe(false);
    expect(secondLarge.cacheHit).toBe(false);
    expect(secondLarge.module.value).toBe("x".repeat(5_000));
    expect(calls).toBe(4);

    if (process.platform !== "win32") {
      const outside = await mkdtemp(join(tmpdir(), "vibelang-asset-cache-outside-"));
      roots.push(outside);
      await writeFile(join(root, "late.cachebound"), "late");
      const lateCache = join(root, ".late-cache");
      const lateCompiler = inProcessCompiler({ root, cacheDirectory: lateCache }).register(loader);
      await symlink(outside, lateCache);
      await expect(lateCompiler.compile("late.cachebound"))
        .rejects.toThrow("cache directory changed filesystem authority");
    }
  });

  test("cache validation preserves top-level inode authority", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "vibelang-asset-cache-inode-"));
    roots.push(root);
    await writeFile(join(root, "main.inode"), "same");
    await writeFile(join(root, "dependency.txt"), "same");
    let calls = 0;
    const loader: AssetLoader = {
      id: "test:cache-inode-authority",
      version: "1",
      implementationDigest: "cache-inode-authority-v1",
      extensions: [".inode"],
      async load(asset, context) {
        calls += 1;
        const dependency = await context.readText("./dependency.txt");
        return {
          format: "inode",
          value: dependency,
          emittedTypeScript: `export default ${JSON.stringify(asset.text())}`,
          declaration: "declare const value: string; export default value",
          diagnostics: [], spans: [],
        };
      },
    };
    const compiler = inProcessCompiler({ root, cacheDirectory: join(root, ".cache") }).register(loader);
    expect((await compiler.compile("main.inode")).cacheHit).toBe(false);
    expect((await compiler.compile("main.inode")).cacheHit).toBe(true);
    await rm(join(root, "dependency.txt"));
    await link(join(root, "main.inode"), join(root, "dependency.txt"));
    await expect(compiler.compile("main.inode")).rejects.toThrow("hard-link aliases are forbidden");
    expect(calls).toBe(2);
  });

  test("failed dependency probes cannot produce cacheable output", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-assets-negative-dep-"));
    roots.push(root);
    await writeFile(join(root, "value.probe"), "value");
    const loader: AssetLoader = {
      id: "test:negative-dependency",
      version: "1",
      implementationDigest: "negative-dependency-v1",
      extensions: [".probe"],
      async load(_asset, context) {
        try { await context.readText("./optional.txt"); } catch { /* probe */ }
        return {
          format: "probe", value: true,
          emittedTypeScript: "export default true",
          declaration: "declare const value: true; export default value",
          diagnostics: [], spans: [],
        };
      },
    };
    const compiler = inProcessCompiler({ root, cacheDirectory: join(root, ".cache") }).register(loader);
    await expect(compiler.compile("value.probe")).rejects.toThrow("failed dependency request");
    await writeFile(join(root, "optional.txt"), "now-present");
    const built = await compiler.compile("value.probe");
    expect(built.dependencies).toHaveLength(1);
    expect(built.cacheHit).toBe(false);
  });

  test("const JSON emit preserves literal intent", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-json-"));
    roots.push(root);
    await writeFile(join(root, "config.json"), '{"mode":"prod","ports":[80,443]}');
    const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache") });
    const ordinary = await compiler.compile("config.json", { type: "json" });
    expect(ordinary.module.format).toBe("json");
    expect(ordinary.module.emittedTypeScript).not.toContain("as const");
    const built = await compiler.compile("config.json", { type: "json", mode: "const" });
    expect(built.module.emittedTypeScript).toContain("as const");
    expect(built.module.value).toEqual({ mode: "prod", ports: [80, 443] });
    await writeFile(join(root, "hostile.json"), '{"__proto__":{"safe":true}}');
    const hostile = await compiler.compile("hostile.json", { type: "json", mode: "const" });
    expect(Object.hasOwn(hostile.module.value as object, "__proto__")).toBe(true);
    expect(hostile.module.emittedTypeScript).toContain('["__proto__"]');
  });

  test("import-attribute types select text and bytes independently of extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-raw-assets-"));
    roots.push(root);
    await writeFile(join(root, "query.sql"), "select 1;\n");
    await writeFile(join(root, "image.bin"), new Uint8Array([0, 127, 255]));
    const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache") });
    const textAsset = await compiler.compile("query.sql", { type: "text" });
    const byteAsset = await compiler.compile("image.bin", { type: "bytes" });
    expect(textAsset.module.value).toBe("select 1;\n");
    expect(textAsset.module.declaration).toContain("string");
    expect(byteAsset.module.value).toEqual([0, 127, 255]);
    expect(byteAsset.module.emittedTypeScript).toContain("new Uint8Array");
    await expect(compiler.compile("query.sql", { type: "unknown" }))
      .rejects.toThrow("import type 'unknown'");
  });

  test("canonical build identities do not alias undefined with user strings", () => {
    expect(() => canonical(undefined)).toThrow("undefined");
    expect(() => canonical({ value: undefined })).toThrow("undefined");
    expect(canonical("$undefined")).toBe('"$undefined"');
    expect(compareStableStrings("z", "ä")).toBe(-1);
    let nested: unknown = null;
    for (let index = 0; index < 600; index++) nested = [nested];
    expect(() => stableClone(nested)).toThrow("nesting is too deep");
  });

  test("ordinary TypeScript declarations produce validator IR", () => {
    const schema = deriveSchema(`
      type Mode = "safe" | "fast";
      interface Config { mode: Mode; retries: number; tags?: string[] }
    `, "Config");
    expect(parseWithSchema<{ mode: string; retries: number }>(schema, { mode: "safe", retries: 2 }))
      .toEqual({ mode: "safe", retries: 2 });
    try {
      parseWithSchema(schema, { mode: "broken", retries: 2 });
      throw new Error("expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationFailure);
      expect((error as Record<PropertyKey, unknown>)[Symbol.for("vibelang.failure")]).toBe(true);
      expect(isVibeFailure(error)).toBe(true);
    }
    expect(catchFailure(
      () => parseWithSchema(schema, { mode: "broken", retries: 2 }),
      (failure) => failure._tag,
    )).toBe("ValidationFailure");
  });

  test("derived schemas require own fields and preserve hostile property names", () => {
    const role = deriveSchema('interface Role { role: string; "__proto__": string }', "Role");
    const inherited = Object.create({ role: "admin" }) as Record<string, unknown>;
    Object.defineProperty(inherited, "__proto__", { value: "data", enumerable: true });
    expect(() => parseWithSchema(role, inherited)).toThrow("$input expected object");
    const valid = JSON.parse('{"role":"admin","__proto__":"data"}') as Record<string, unknown>;
    expect(parseWithSchema<Record<string, unknown>>(role, valid)).toEqual(valid);
    expect(() => deriveSchema("interface Child extends Role { name: string }", "Child"))
      .toThrow("does not support interface inheritance");
  });

  test("schema decoding rejects sparse arrays and never evaluates accessors", () => {
    const schema = deriveSchema("interface Input { values: string[]; role: string }", "Input");
    const sparse = new Array(1);
    expect(() => parseWithSchema(schema, { values: sparse, role: "admin" })).toThrow("$input.values[0]");
    let getterCalls = 0;
    const accessor = { values: ["ok"] } as Record<string, unknown>;
    Object.defineProperty(accessor, "role", {
      enumerable: true,
      get() { getterCalls++; return "admin"; },
    });
    expect(() => parseWithSchema(schema, accessor)).toThrow("$input.role");
    expect(getterCalls).toBe(0);

    let elementGetterCalls = 0;
    const values: string[] = [];
    Object.defineProperty(values, 0, {
      enumerable: true,
      get() { elementGetterCalls++; return "not-safe"; },
    });
    values.length = 1;
    expect(() => parseWithSchema(schema, { values, role: "admin" })).toThrow("$input.values[0]");
    expect(elementGetterCalls).toBe(0);
  });

  test("poisoned nested cache keys fail closed instead of becoming cache paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-cache-key-"));
    roots.push(root);
    await writeFile(join(root, "main.parent"), "main");
    await writeFile(join(root, "child.json"), '{"safe":true}');
    let calls = 0;
    const loader: AssetLoader = {
      id: "test:parent",
      version: "1",
      implementationDigest: "parent-loader-v1",
      extensions: [".parent"],
      async load(_asset, context) {
        calls++;
        const child = await context.import("./child.json");
        return {
          format: "parent", value: child.module.value,
          emittedTypeScript: "export default true",
          declaration: "declare const value: true; export default value",
          diagnostics: [], spans: [],
        };
      },
    };
    const cacheDirectory = join(root, ".cache");
    const compiler = inProcessCompiler({ root, cacheDirectory }).register(loader);
    const first = await compiler.compile("main.parent");
    const indexPath = join(cacheDirectory, "index", `${first.logicalKey}.json`);
    const index = JSON.parse(await readFile(indexPath, "utf8")) as {
      dependencies: Array<{ logicalKey?: string }>;
    };
    index.dependencies[0]!.logicalKey = "../../../attacker-controlled-cache-key";
    await writeFile(indexPath, JSON.stringify(index));
    const rebuilt = await compiler.compile("main.parent");
    expect(rebuilt.cacheHit).toBe(false);
    expect(calls).toBe(2);
  });

  test("portable cache metadata cannot read dependencies from another project root", async () => {
    const firstRoot = await mkdtemp(join(tmpdir(), "vibelang-root-a-"));
    const secondRoot = await mkdtemp(join(tmpdir(), "vibelang-root-b-"));
    const sharedCache = await mkdtemp(join(tmpdir(), "vibelang-shared-cache-"));
    roots.push(firstRoot, secondRoot, sharedCache);
    for (const root of [firstRoot, secondRoot]) await writeFile(join(root, "main.kv"), "same-source\n");
    await writeFile(join(firstRoot, "dep.txt"), "A");
    await writeFile(join(secondRoot, "dep.txt"), "B");
    const loader: AssetLoader = {
      id: "test:cross-root",
      version: "1",
      implementationDigest: "cross-root-loader-code-v1",
      extensions: [".kv"],
      async load(_asset, context) {
        const value = await context.readText("./dep.txt");
        return {
          format: "kv", value,
          emittedTypeScript: `export default ${JSON.stringify(value)}`,
          declaration: "declare const value: string; export default value",
          diagnostics: [], spans: [],
        };
      },
    };
    const first = await inProcessCompiler({ root: firstRoot, cacheDirectory: sharedCache }).register(loader).compile("main.kv");
    const second = await inProcessCompiler({ root: secondRoot, cacheDirectory: sharedCache }).register(loader).compile("main.kv");
    expect(first.module.value).toBe("A");
    expect(second.module.value).toBe("B");
    expect(second.cacheHit).toBe(false);
    expect(second.dependencies[0]?.path).toBe("dep.txt");
  });

  test("loader code identity and real filesystem roots are cache authority", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-loader-identity-"));
    const outside = await mkdtemp(join(tmpdir(), "vibelang-loader-outside-"));
    roots.push(root, outside);
    await writeFile(join(root, "value.kv"), "value");
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(join(outside, "secret.txt"), join(root, "linked.txt"));
    const makeLoader = (implementationDigest: string, suffix: string): AssetLoader => ({
      id: "test:identity",
      version: "1",
      implementationDigest,
      extensions: [".kv"],
      load(asset) {
        const value = `${asset.text()}${suffix}`;
        return {
          format: "kv", value,
          emittedTypeScript: `export default ${JSON.stringify(value)}`,
          declaration: "declare const value: string; export default value",
          diagnostics: [], spans: [],
        };
      },
    });
    const cacheDirectory = join(root, ".cache");
    const first = await inProcessCompiler({ root, cacheDirectory }).register(makeLoader("code-a", "A")).compile("value.kv");
    const second = await inProcessCompiler({ root, cacheDirectory }).register(makeLoader("code-b", "B")).compile("value.kv");
    expect(first.module.value).toBe("valueA");
    expect(second.module.value).toBe("valueB");
    expect(second.cacheHit).toBe(false);
    await expect(new AssetCompiler({ root, cacheDirectory }).compile("linked.txt"))
      .rejects.toThrow("escaped project root");
  });

  test("loader registration is snapshotted and commits atomically", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-loader-registration-"));
    roots.push(root);
    await writeFile(join(root, "value.snap"), "value");
    await writeFile(join(root, "value.partial"), "value");
    const loader: AssetLoader = {
      id: "test:snapshot-registration",
      version: "1",
      implementationDigest: "snapshot-registration-code-v1",
      extensions: [".snap"],
      load: (asset) => ({
        format: "snapshot", value: asset.text(),
        emittedTypeScript: `export default ${JSON.stringify(asset.text())}`,
        declaration: "declare const value: string; export default value",
        diagnostics: [], spans: [],
      }),
    };
    const compiler = inProcessCompiler({ root, cacheDirectory: join(root, ".cache") }).register(loader);
    loader.id = "mutated";
    loader.version = "999";
    loader.extensions = [".other"];
    loader.load = () => { throw new Error("mutated callback ran"); };
    const built = await compiler.compile("value.snap");
    expect(built.loader).toBe("test:snapshot-registration@1");
    expect(built.module.value).toBe("value");

    const partial: AssetLoader = {
      ...loader,
      id: "test:partial",
      version: "1",
      implementationDigest: "partial-code-v1",
      extensions: [".partial"],
      load: () => { throw new Error("partial loader should not be installed"); },
    };
    const conflict: AssetLoader = { ...partial, id: "test:conflict", extensions: [".json"] };
    expect(() => compiler.register(partial, conflict)).toThrow("loader conflict");
    await expect(compiler.compile("value.partial")).rejects.toThrow("no comptime loader");
  });

  test("invalid generated loader modules never enter the cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-loader-output-"));
    roots.push(root);
    await writeFile(join(root, "bad.kv"), "bad");
    const invalid: AssetLoader = {
      id: "test:invalid-output",
      version: "1",
      implementationDigest: "invalid-output-code-v1",
      extensions: [".kv"],
      load: () => ({
        format: "bad", value: null,
        emittedTypeScript: "export default {",
        declaration: "declare const value: string; export default value",
        diagnostics: [], spans: [],
      }),
    };
    await expect(inProcessCompiler({ root, cacheDirectory: join(root, ".cache") }).register(invalid).compile("bad.kv"))
      .rejects.toThrow("loader output");
  });

  test("options are snapshotted and cache envelopes reject poisoned output", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-loader-snapshot-"));
    roots.push(root);
    await writeFile(join(root, "value.kv"), "value");
    let started!: () => void;
    let release!: () => void;
    const didStart = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const loader: AssetLoader = {
      id: "test:option-snapshot",
      version: "1",
      implementationDigest: "option-snapshot-code-v1",
      extensions: [".kv"],
      async load(_asset, context) {
        calls++;
        const flavor = String(context.options.flavor);
        if (calls === 1) { started(); await gate; }
        return {
          format: "kv", value: flavor,
          emittedTypeScript: `export default ${JSON.stringify(flavor)}`,
          declaration: "declare const value: string; export default value",
          diagnostics: [], spans: [],
        };
      },
    };
    const cacheDirectory = join(root, ".cache");
    const compiler = inProcessCompiler({ root, cacheDirectory }).register(loader);
    const mutable = { flavor: "A" };
    const pending = compiler.compile("value.kv", mutable);
    await didStart;
    mutable.flavor = "B";
    release();
    const first = await pending;
    const second = await compiler.compile("value.kv", { flavor: "B" });
    expect(first.module.value).toBe("A");
    expect(second.module.value).toBe("B");
    expect(second.key).not.toBe(first.key);

    const objectPath = join(cacheDirectory, "objects", `${second.key}.json`);
    const envelope = JSON.parse(await readFile(objectPath, "utf8")) as {
      build: { module: { value: unknown } };
      outputDigest: string;
    };
    envelope.build.module.value = "poison";
    // Even an internally consistent rewritten envelope cannot change the
    // output while retaining the content-addressed key.
    envelope.outputDigest = digest(envelope.build);
    await writeFile(objectPath, JSON.stringify(envelope));
    const rebuilt = await compiler.compile("value.kv", { flavor: "B" });
    expect(rebuilt.cacheHit).toBe(false);
    expect(rebuilt.module.value).toBe("B");
    expect(calls).toBe(3);
  });

  test("loader values must be stable JSON before first return and cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-loader-value-"));
    roots.push(root);
    await writeFile(join(root, "value.kv"), "value");
    const exotic: AssetLoader = {
      id: "test:exotic-value",
      version: "1",
      implementationDigest: "exotic-value-code-v1",
      extensions: [".kv"],
      load: () => ({
        format: "kv", value: new Date(0),
        emittedTypeScript: "export default null",
        declaration: "declare const value: null; export default value",
        diagnostics: [], spans: [],
      }),
    };
    await expect(inProcessCompiler({ root, cacheDirectory: join(root, ".cache") }).register(exotic).compile("value.kv"))
      .rejects.toThrow("Date");
  });

  test("third-party loaders run without ambient authority through tracked RPC", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-sandboxed-loader-"));
    roots.push(root);
    await writeFile(join(root, "value.kv"), "answer=42\n");
    await writeFile(join(root, "shape.txt"), "answer\n");
    const modulePath = join(root, "loader.ts");
    await writeFile(modulePath, `
      interface Asset { path: string; text(): string }
      interface Context { target: string; readText(path: string): Promise<string> }
      export default async function load(asset: Asset, context: Context) {
        const key = (await context.readText("./shape.txt")).trim()
        const entries = Object.fromEntries(asset.text().trim().split("\\n").map(line => line.split("=")))
        const value = { key, answer: entries[key], target: context.target, path: asset.path }
        return {
          format: "kv", value,
          emittedTypeScript: "export default " + JSON.stringify(value) + " as const",
          declaration: "declare const value: { readonly answer: string }; export default value",
          diagnostics: [], spans: [],
        }
      }
    `);
    const loader = createSandboxedLoader({
      id: "test:sandboxed-kv",
      version: "1",
      extensions: [".kv"],
      modulePath,
    });
    const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache") }).register(loader);
    const first = await compiler.compile("value.kv");
    const second = await compiler.compile("value.kv");
    expect(first.module.value).toEqual({
      key: "answer",
      answer: "42",
      target: "typescript-node",
      path: "value.kv",
    });
    expect(first.dependencies).toEqual([{
      path: "shape.txt",
      digest: first.dependencies[0]?.digest,
      kind: "file",
      access: "text",
    }]);
    expect(second.cacheHit).toBe(true);
    expect(second.key).toBe(first.key);
  });

  test("sandboxed loaders cannot observe time or ambient files and are killed at limits", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-loader-denied-"));
    roots.push(root);
    await writeFile(join(root, "time.bad"), "value");
    const timeModule = join(root, "time-loader.mjs");
    await writeFile(timeModule, `export default () => Date.now()`);
    const timeLoader = createSandboxedLoader({
      id: "test:denied-time", version: "1", extensions: [".bad"], modulePath: timeModule,
    });
    await expect(new AssetCompiler({ root, cacheDirectory: join(root, ".time-cache") })
      .register(timeLoader).compile("time.bad")).rejects.toThrow("Date.now is unavailable");

    const ambientModule = join(root, "ambient-loader.mjs");
    await writeFile(ambientModule, `export default () => {
      const value = {
        process: typeof process, caches: typeof caches, file: typeof File,
        atomics: typeof Atomics, weakRef: typeof WeakRef, buffer: typeof Buffer,
        performanceMark: typeof PerformanceMark,
      }
      return {
        format: "ambient", value,
        emittedTypeScript: "export default " + JSON.stringify(value),
        declaration: "declare const value: Record<string, string>; export default value",
        diagnostics: [], spans: [],
      }
    }`);
    const ambientLoader = createSandboxedLoader({
      id: "test:denied-ambient", version: "1", extensions: [".ambient"], modulePath: ambientModule,
    });
    await writeFile(join(root, "value.ambient"), "value");
    const ambient = await new AssetCompiler({ root, cacheDirectory: join(root, ".ambient-cache") })
      .register(ambientLoader).compile("value.ambient");
    expect(ambient.module.value).toEqual({
      process: "undefined", caches: "undefined", file: "undefined",
      atomics: "undefined", weakRef: "undefined", buffer: "undefined",
      performanceMark: "undefined",
    });

    const importedModule = join(root, "imported-loader.mjs");
    await writeFile(importedModule, `import process from "node:process"; export default () => process.pid`);
    expect(() => createSandboxedLoader({
      id: "test:denied-import", version: "1", extensions: [".imported"], modulePath: importedModule,
    })).toThrow("may not import modules");

    const objectUrlModule = join(root, "object-url-loader.mjs");
    await writeFile(objectUrlModule, `export default () => URL.createObjectURL(new Blob())`);
    const objectUrlLoader = createSandboxedLoader({
      id: "test:denied-object-url", version: "1", extensions: [".objecturl"], modulePath: objectUrlModule,
    });
    await writeFile(join(root, "value.objecturl"), "value");
    await expect(new AssetCompiler({ root, cacheDirectory: join(root, ".object-url-cache") })
      .register(objectUrlLoader).compile("value.objecturl")).rejects.toThrow("URL.createObjectURL is unavailable");

    const recoveredModule = join(root, "recovered-loader.mjs");
    await writeFile(recoveredModule, `export default async (_asset, context) => {
      try { await context.readText("./missing.txt") } catch {}
      return {
        format: "recovered", value: true, emittedTypeScript: "export default true",
        declaration: "declare const value: true; export default value", diagnostics: [], spans: [],
      }
    }`);
    const recoveredLoader = createSandboxedLoader({
      id: "test:recovered-read", version: "1", extensions: [".recovered"], modulePath: recoveredModule,
    });
    await writeFile(join(root, "value.recovered"), "value");
    await expect(new AssetCompiler({ root, cacheDirectory: join(root, ".recovered-cache") })
      .register(recoveredLoader).compile("value.recovered")).rejects.toThrow("dependency request failed");

    await writeFile(join(root, "loop.hang"), "value");
    const loopModule = join(root, "loop-loader.mjs");
    await writeFile(loopModule, `export default () => { while (true) {} }`);
    const loopLoader = createSandboxedLoader({
      id: "test:bounded-loop", version: "1", extensions: [".hang"], modulePath: loopModule,
      timeoutMs: 100,
    });
    await expect(new AssetCompiler({ root, cacheDirectory: join(root, ".loop-cache") })
      .register(loopLoader).compile("loop.hang")).rejects.toThrow("timed out");
  });

  test("comptime evaluation is hermetic, dependency tracked, and content cached", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-comptime-"));
    roots.push(root);
    await writeFile(join(root, "config.txt"), "alpha\n");
    await writeFile(join(root, "data.json"), '{"answer":42}');
    const modulePath = join(root, "derive.ts");
    await writeFile(modulePath, `
      interface Context {
        readonly target: string
        readText(path: string): Promise<string>
        import(path: string, options?: Record<string, unknown>): Promise<{ module: { value: unknown } }>
      }
      export default async function derive(prefix: string, context: Context) {
        const config = (await context.readText("./config.txt")).trim()
        const imported = await context.import("./data.json", { const: true })
        return { label: prefix + ":" + config, data: imported.module.value, target: context.target }
      }
    `);
    const cacheDirectory = join(root, ".cache");
    const assets = new AssetCompiler({ root, cacheDirectory });
    const compiler = new ComptimeCompiler({ root, cacheDirectory, assets });
    const module = createSandboxedComptimeModule({
      id: "test:derive",
      version: "1",
      modulePath,
    });
    const first = await compiler.evaluate(module, ["value"]);
    const second = await compiler.evaluate(module, ["value"]);
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.key).toBe(first.key);
    expect(second.value).toEqual({
      data: { answer: 42 },
      label: "value:alpha",
      target: "typescript-node",
    });
    expect(second.dependencies.map((dependency) => dependency.kind).sort()).toEqual(["asset", "file"]);

    await writeFile(join(root, "config.txt"), "beta\n");
    const rebuilt = await compiler.evaluate(module, ["value"]);
    expect(rebuilt.cacheHit).toBe(false);
    expect(rebuilt.key).not.toBe(first.key);
    expect(rebuilt.value).toMatchObject({ label: "value:beta" });
  });

  test("comptime cache values are bound to their content key", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-comptime-poison-"));
    roots.push(root);
    const modulePath = join(root, "constant.mjs");
    await writeFile(modulePath, `export default () => ({ answer: 42 })`);
    const cacheDirectory = join(root, ".cache");
    const compiler = new ComptimeCompiler({ root, cacheDirectory });
    const module = createSandboxedComptimeModule({ id: "test:constant", version: "1", modulePath });
    await rm(modulePath);
    const first = await compiler.evaluate(module);
    const objectPath = join(cacheDirectory, "comptime-objects", `${first.key}.json`);
    const envelope = JSON.parse(await readFile(objectPath, "utf8")) as {
      build: { value: unknown };
      outputDigest: string;
    };
    envelope.build.value = { answer: 666 };
    envelope.outputDigest = digest(envelope.build);
    await writeFile(objectPath, JSON.stringify(envelope));
    const rebuilt = await compiler.evaluate(module);
    expect(rebuilt.cacheHit).toBe(false);
    expect(rebuilt.value).toEqual({ answer: 42 });
    expect(Object.isFrozen(rebuilt.dependencies)).toBe(true);
  });

  test("comptime compiler rejects structurally forged host evaluators", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-comptime-forged-"));
    roots.push(root);
    let evaluated = false;
    const fake = {
      id: "forged", version: "1", sourcePath: join(root, "fake.mjs"), implementationDigest: "forged",
      async evaluate() { evaluated = true; return null; },
    };
    await expect(new ComptimeCompiler({ root, cacheDirectory: join(root, ".cache") })
      .evaluate(fake as never)).rejects.toThrow("createSandboxedComptimeModule");
    expect(evaluated).toBe(false);
  });

  test("sandboxed comptime rejects ambient entropy, exotic values, and request floods", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-comptime-policy-"));
    roots.push(root);
    await writeFile(join(root, "input.txt"), "value");
    const compiler = new ComptimeCompiler({ root, cacheDirectory: join(root, ".cache") });

    const entropyPath = join(root, "entropy.mjs");
    await writeFile(entropyPath, `export default () => performance.now()`);
    await expect(compiler.evaluate(createSandboxedComptimeModule({
      id: "test:entropy", version: "1", modulePath: entropyPath,
    }))).rejects.toThrow("performance.now is unavailable");

    const localePath = join(root, "locale.mjs");
    await writeFile(localePath, `export default () => ["ä", "z"].sort((a, b) => a.localeCompare(b))`);
    const locale = await compiler.evaluate(createSandboxedComptimeModule({
      id: "test:locale", version: "1", modulePath: localePath,
    }));
    expect(locale.value).toEqual(["z", "ä"]);

    const exoticPath = join(root, "exotic.mjs");
    await writeFile(exoticPath, `export default () => {
      try { Object.getPrototypeOf = () => Object.prototype } catch {}
      try { JSON.stringify = () => "null" } catch {}
      return new Map()
    }`);
    await expect(compiler.evaluate(createSandboxedComptimeModule({
      id: "test:exotic", version: "1", modulePath: exoticPath,
    }))).rejects.toThrow("exotic object");

    const floodPath = join(root, "flood.mjs");
    await writeFile(floodPath, `export default async (_context, context) => {
      await context.readText("./input.txt")
      await context.readText("./input.txt")
      return null
    }`);
    await expect(compiler.evaluate(createSandboxedComptimeModule({
      id: "test:flood", version: "1", modulePath: floodPath, maxRequests: 1,
    }), [null])).rejects.toThrow("dependency request policy");

    const oversizedPath = join(root, "oversized.mjs");
    await writeFile(oversizedPath, `export default () => "x".repeat(1024 * 1024)`);
    await expect(compiler.evaluate(createSandboxedComptimeModule({
      id: "test:oversized", version: "1", modulePath: oversizedPath, maxOutputBytes: 1024,
    }))).rejects.toThrow("output limit");
  });

  // Provisional built-in shapes: docs/ASSET_LOADERS.md leaves the parsed
  // markdown document, front matter typing, and the MDX component module open.

  test("provisional markdown modules export literal front matter, body, and located headings", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-markdown-"));
    roots.push(root);
    const source = [
      "---",
      "title: Typed assets",
      "draft: false",
      "version: 3",
      'quoted: "a: b # c"',
      "# a front matter comment",
      "owner:",
      "  team: compiler",
      "  handle: vibelang",
      "tags:",
      "  - assets",
      "  - markdown",
      "---",
      "# Overview",
      "",
      "Prose with an inline `# span`.",
      "",
      "```md",
      "# fenced heading",
      "```",
      "",
      "## Details ##",
      "",
    ].join("\n");
    await writeFile(join(root, "guide.md"), source);
    const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache") });
    const built = await compiler.compile("guide.md", { type: "markdown" });
    const value = built.module.value as {
      source: string;
      body: string;
      frontmatter: Record<string, unknown>;
      headings: readonly { level: number; text: string; offset: number }[];
    };
    expect(built.module.format).toBe("markdown");
    expect(built.loader).toBe("vibelang:builtin/markdown@2");
    expect(value.source).toBe(source);
    expect(value.frontmatter).toEqual({
      title: "Typed assets",
      draft: false,
      version: 3,
      quoted: "a: b # c",
      owner: { team: "compiler", handle: "vibelang" },
      tags: ["assets", "markdown"],
    });
    expect(value.body.startsWith("# Overview\n")).toBe(true);
    // Fenced code is not a heading source and offsets are authored offsets.
    expect(value.headings).toEqual([
      { level: 1, text: "Overview", offset: source.indexOf("# Overview") },
      { level: 2, text: "Details", offset: source.indexOf("## Details") },
    ]);
    expect(built.module.spans).toContainEqual({
      generatedOffset: built.module.emittedTypeScript.indexOf('{ ["level"]: 1'),
      sourceOffset: source.indexOf("# Overview"),
    });
    // Front matter participates in literal type derivation exactly like const JSON.
    expect(built.module.emittedTypeScript).toContain('export const frontmatter = { ["draft"]: false,');
    expect(built.module.emittedTypeScript).toContain("] as const;");
    expect(built.module.emittedTypeScript).toContain("export default source;");
    expect(built.module.declaration).toContain('typeof import("./asset.generated.ts").frontmatter');
    // `{ type: "text" }` keeps the locked zero-ceremony string contract.
    const text = await compiler.compile("guide.md", { type: "text" });
    expect(text.module.format).toBe("text");
    expect(text.module.value).toBe(source);
    expect(text.module.emittedTypeScript).toBe(`const value = ${JSON.stringify(source)};\nexport default value;\n`);
  });

  test("markdown front matter outside the documented YAML subset is a located diagnostic", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-markdown-frontmatter-"));
    roots.push(root);
    const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache") });
    let counter = 0;
    const reject = async (text: string): Promise<AssetSourceError> => {
      const name = `case-${++counter}.md`;
      await writeFile(join(root, name), text);
      try {
        await compiler.compile(name, { type: "markdown" });
      } catch (error) {
        expect(error).toBeInstanceOf(AssetSourceError);
        return error as AssetSourceError;
      }
      throw new Error(`expected ${name} to fail`);
    };

    const ambiguous = await reject("---\nmaybe: yes\n---\nbody\n");
    expect(ambiguous.offset).toBe(11);
    expect(ambiguous.line).toBe(2);
    expect(ambiguous.column).toBe(8);
    expect(ambiguous.message).toContain("ambiguous YAML scalar 'yes'");
    expect(ambiguous.diagnostics).toEqual([{ level: "error", message: ambiguous.issues[0]!.message, offset: 11 }]);

    expect((await reject("---\nport: 0x10\n---\n")).message).toContain("ambiguous YAML scalar '0x10'");
    expect((await reject("---\nkey:\tvalue\n---\n")).offset).toBe(8);
    expect((await reject("---\n  key: value\n---\n")).offset).toBe(6);
    expect((await reject("---\na: 1\na: 2\n---\n")).message).toContain("duplicate front matter key 'a'");
    expect((await reject("---\na: 1\n")).offset).toBe(0);
    expect((await reject("---\na:\n---\n")).message).toContain("has no value");
    expect((await reject("---\na: {b: 1}\n---\n")).offset).toBe(7);
    expect((await reject('---\na: "unterminated\n---\n')).message).toContain("unterminated double-quoted");
    expect((await reject("---\n[list]\n---\n")).message).toContain("'key: value'");

    const deep = await reject("---\na:\n  b:\n    c: 1\n---\n");
    expect(deep.issues.map((issue) => issue.offset)).toEqual([9, 16]);
    expect(deep.issues[0]!.message).toContain("one nested level");
    expect(deep.message).toContain("(+1 more)");

    const mixed = await reject("---\na:\n  - one\n  b: 2\n---\n");
    expect(mixed.issues[0]!.message).toContain("mixes list items and mapping entries");

    // CRLF documents parse and keep authored offsets.
    await writeFile(join(root, "crlf.md"), "---\r\ntitle: CRLF\r\n---\r\n# Head\r\n");
    expect((await compiler.compile("crlf.md", { type: "markdown" })).module.value).toMatchObject({
      frontmatter: { title: "CRLF" },
      headings: [{ level: 1, text: "Head", offset: 23 }],
    });

    // A hostile front matter key stays a data property in value and in emit.
    await writeFile(join(root, "hostile.md"), "---\n__proto__: data\n---\nbody\n");
    const hostile = await compiler.compile("hostile.md", { type: "markdown" });
    const frontmatter = (hostile.module.value as { frontmatter: object }).frontmatter;
    expect(Object.hasOwn(frontmatter, "__proto__")).toBe(true);
    expect(hostile.module.emittedTypeScript).toContain('["__proto__"]: "data"');

    // A document with no front matter block keeps the whole source as its body.
    await writeFile(join(root, "plain.md"), "# Plain\n");
    const plain = await compiler.compile("plain.md", { type: "markdown" });
    expect((plain.module.value as { frontmatter: Record<string, unknown>; body: string }).frontmatter).toEqual({});
    expect((plain.module.value as { body: string }).body).toBe("# Plain\n");
  });

  test("provisional mdx modules emit a render tree whose expression holes stay unevaluated", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-mdx-"));
    roots.push(root);
    const source = [
      "---",
      "name: POC coder",
      "---",
      '<System tone="terse" strict count={2}>You are a coding agent.</System>',
      "<Context>Repository: {repository}</Context>",
      "<Task>{task}<Nested><Inner /></Nested></Task>",
      "```mdx",
      "<NotAComponent>{notAHole}</NotAComponent>",
      "```",
      "",
    ].join("\n");
    await writeFile(join(root, "prompt.mdx"), source);
    const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache") });
    const built = await compiler.compile("prompt.mdx", { type: "mdx" });
    const value = built.module.value as {
      source: string;
      body: string;
      frontmatter: Record<string, unknown>;
      components: readonly string[];
      expressions: readonly string[];
      tree: readonly unknown[];
    };
    expect(built.loader).toBe("vibelang:builtin/mdx@2");
    expect(value.frontmatter).toEqual({ name: "POC coder" });
    expect(value.components).toEqual(["System", "Context", "Task", "Nested", "Inner"]);
    expect(value.expressions).toEqual(["repository", "task"]);
    expect(value.tree.slice(0, 3)).toEqual([
      {
        kind: "element",
        name: "System",
        props: { tone: "terse", strict: true, count: 2 },
        children: [{ kind: "text", value: "You are a coding agent." }],
      },
      { kind: "text", value: "\n" },
      {
        kind: "element",
        name: "Context",
        props: {},
        children: [
          { kind: "text", value: "Repository: " },
          { kind: "expression", placeholder: "repository" },
        ],
      },
    ]);
    expect(value.tree[4]).toEqual({
      kind: "element",
      name: "Task",
      props: {},
      children: [
        { kind: "expression", placeholder: "task" },
        {
          kind: "element",
          name: "Nested",
          props: {},
          children: [{ kind: "element", name: "Inner", props: {}, children: [] }],
        },
      ],
    });
    // A fenced block is literal text, so it contributes no component or hole.
    expect(JSON.stringify(value.tree)).toContain("<NotAComponent>{notAHole}</NotAComponent>");
    // Holes are data, never generated code: nothing interpolates at comptime.
    expect(built.module.emittedTypeScript).toContain('{ ["kind"]: "expression", ["placeholder"]: "task" }');
    expect(built.module.emittedTypeScript).toContain("export default tree;");
    expect(built.module.emittedTypeScript).not.toContain("${");
    expect(built.module.spans).toContainEqual({
      generatedOffset: built.module.emittedTypeScript.indexOf('{ ["kind"]: "element", ["name"]: "Context"'),
      sourceOffset: source.indexOf("<Context>"),
    });
    // The library-facing fields the agent prompt renderer already consumes.
    expect(value.source).toBe(source);
    expect(value.body).toBe(source.slice(source.indexOf("<System")));
  });

  test("mdx parse failures carry authored offsets", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-mdx-errors-"));
    roots.push(root);
    const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache") });
    let counter = 0;
    const reject = async (text: string): Promise<AssetSourceError> => {
      const name = `case-${++counter}.mdx`;
      await writeFile(join(root, name), text);
      try {
        await compiler.compile(name, { type: "mdx" });
      } catch (error) {
        expect(error).toBeInstanceOf(AssetSourceError);
        return error as AssetSourceError;
      }
      throw new Error(`expected ${name} to fail`);
    };

    const unclosed = await reject("intro\n<System>text\n");
    expect(unclosed.offset).toBe(6);
    expect(unclosed.line).toBe(2);
    expect(unclosed.column).toBe(1);
    expect(unclosed.message).toContain("unclosed MDX element <System>");

    const mismatched = await reject("<A>x</B>\n");
    expect(mismatched.offset).toBe(4);
    expect(mismatched.message).toContain("does not match open element <A>");

    expect((await reject("<A>{task</A>\n")).offset).toBe(3);
    expect((await reject("<A>{a + b}</A>\n")).message).toContain("one identifier placeholder");
    const attribute = await reject("<A x={value}>y</A>\n");
    expect(attribute.offset).toBe(5);
    expect(attribute.message).toContain("never evaluated at comptime");
    expect((await reject("</A>\n")).message).toContain("unexpected MDX closing tag </A>");
    expect((await reject("<A x=1>y</A>\n")).offset).toBe(5);
    expect((await reject("<A x='a' x='b'>y</A>\n")).message).toContain("duplicate attribute 'x'");

    // Front matter offsets stay authored offsets through the MDX path too.
    const located = await reject("---\nname: Yes\n---\n<A>{task}</A>\n");
    expect(located.offset).toBe(10);
    expect(located.line).toBe(2);

    // A hostile attribute name stays a computed data property.
    await writeFile(join(root, "hostile.mdx"), '<A __proto__="data" />\n');
    const hostile = await compiler.compile("hostile.mdx", { type: "mdx" });
    expect(hostile.module.emittedTypeScript).toContain('["__proto__"]: "data"');
  });

  test("markdown and mdx regeneration is byte-identical and admitted as pure data", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-markdown-graph-"));
    roots.push(root);
    await writeFile(join(root, "guide.md"), "---\ntitle: Guide\ncount: 2\n---\n# One\n\ntext\n");
    await writeFile(join(root, "prompt.mdx"), "---\nname: Coder\n---\n<Task>{task}</Task>\n");
    const first = new AssetCompiler({ root, cacheDirectory: join(root, ".first-cache") });
    const second = new AssetCompiler({ root, cacheDirectory: join(root, ".second-cache") });
    for (const [specifier, type] of [["guide.md", "markdown"], ["prompt.mdx", "mdx"]] as const) {
      const left = await first.compile(specifier, { type });
      const right = await second.compile(specifier, { type });
      expect(right.cacheHit).toBe(false);
      expect(right.key).toBe(left.key);
      expect(right.module.emittedTypeScript).toBe(left.module.emittedTypeScript);
      expect(right.module.declaration).toBe(left.module.declaration);
      expect(digest(right.module)).toBe(digest(left.module));
      expect((await first.compile(specifier, { type })).cacheHit).toBe(true);
    }

    const graph = await compileSourceAssetModules({
      compiler: new AssetCompiler({ root, cacheDirectory: join(root, ".graph-cache") }),
      sources: [{
        fileName: "usage.vibe",
        source: [
          'import guide from "./guide.md" with { type: "markdown" }',
          'import agentPrompt from "./prompt.mdx" with { type: "mdx" }',
          "export { guide, agentPrompt }",
          "",
        ].join("\n"),
      }],
    });
    expect(graph.diagnostics).toEqual([]);
    expect(graph.ok).toBe(true);
    const markdownModule = graph.modules.find((module) => module.resolutionAliases[0]?.endsWith("guide.md"));
    const mdxModule = graph.modules.find((module) => module.resolutionAliases[0]?.endsWith("prompt.mdx"));
    expect(markdownModule?.source).toContain('export const headings = [\n  { ["level"]: 1,');
    expect(markdownModule?.source).toContain("export default source;");
    expect(mdxModule?.source).toContain('{ ["kind"]: "expression", ["placeholder"]: "task" }');
    expect(mdxModule?.source).toContain("export default tree;");
    expect(markdownModule?.references).toEqual([]);
    expect(mdxModule?.depth).toBe(0);
  });

  test("the agent prompt library still renders the built-in mdx module", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-mdx-agent-"));
    roots.push(root);
    await writeFile(join(root, "coding-agent.mdx"), [
      "---",
      "name: POC coder",
      "---",
      "<System>You are a small deterministic coding agent.</System>",
      "<Context>Repository: {repository}</Context>",
      "<Task>{task}</Task>",
      "",
    ].join("\n"));
    const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache") });
    const built = await compiler.compile("coding-agent.mdx");
    const module = built.module.value as { body: string; tree: readonly { kind: string }[] };
    const renderer = mdxPrompt<{ task: string }>(module, ({ task }) => ({ task, repository: "effect-lang" }));
    expect(await renderer.render({ task: "add a test" })).toEqual([
      { role: "system", content: "You are a small deterministic coding agent." },
      { role: "user", content: "Repository: effect-lang\n\nadd a test" },
    ]);
    // The same substitution is expressible from the provisional render tree.
    const bindings: Record<string, string> = { task: "add a test", repository: "effect-lang" };
    const flatten = (nodes: readonly unknown[]): string => nodes.map((node) => {
      const typed = node as { kind: string; value?: string; placeholder?: string; children?: readonly unknown[] };
      if (typed.kind === "text") return typed.value ?? "";
      if (typed.kind === "expression") return bindings[typed.placeholder!] ?? "";
      return flatten(typed.children ?? []);
    }).join("");
    expect(flatten(module.tree).trim()).toBe(
      "You are a small deterministic coding agent.\nRepository: effect-lang\nadd a test",
    );
  });
});
