import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AssetCompiler, type AssetLoader, ValidationFailure, canonical, deriveSchema, parseWithSchema } from "./index.ts";
import { catchFailure, isVibeFailure } from "../runtime/failure.ts";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

describe("comptime assets and derived schemas", () => {
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
    const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache") }).register(loader);
    const first = await compiler.compile("data.kv");
    const second = await compiler.compile("data.kv");
    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.key).toBe(first.key);
    expect(second.dependencies).toHaveLength(1);

    await writeFile(join(root, "shape.txt"), "other\n");
    await expect(compiler.compile("data.kv")).rejects.toThrow("missing other");
  });

  test("const JSON emit preserves literal intent", async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-json-"));
    roots.push(root);
    await writeFile(join(root, "config.json"), '{"mode":"prod","ports":[80,443]}');
    const compiler = new AssetCompiler({ root, cacheDirectory: join(root, ".cache") });
    const built = await compiler.compile("config.json", { const: true });
    expect(built.module.emittedTypeScript).toContain("as const");
    expect(built.module.value).toEqual({ mode: "prod", ports: [80, 443] });
  });

  test("canonical build identities do not alias undefined with user strings", () => {
    expect(() => canonical(undefined)).toThrow("undefined");
    expect(() => canonical({ value: undefined })).toThrow("undefined");
    expect(canonical("$undefined")).toBe('"$undefined"');
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
    expect(() => parseWithSchema(role, inherited)).toThrow("$input.role expected string");
    const valid = JSON.parse('{"role":"admin","__proto__":"data"}') as Record<string, unknown>;
    expect(parseWithSchema<Record<string, unknown>>(role, valid)).toEqual(valid);
    expect(() => deriveSchema("interface Child extends Role { name: string }", "Child"))
      .toThrow("does not support interface inheritance");
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
    const first = await new AssetCompiler({ root: firstRoot, cacheDirectory: sharedCache }).register(loader).compile("main.kv");
    const second = await new AssetCompiler({ root: secondRoot, cacheDirectory: sharedCache }).register(loader).compile("main.kv");
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
    const first = await new AssetCompiler({ root, cacheDirectory }).register(makeLoader("code-a", "A")).compile("value.kv");
    const second = await new AssetCompiler({ root, cacheDirectory }).register(makeLoader("code-b", "B")).compile("value.kv");
    expect(first.module.value).toBe("valueA");
    expect(second.module.value).toBe("valueB");
    expect(second.cacheHit).toBe(false);
    await expect(new AssetCompiler({ root, cacheDirectory }).compile("linked.txt"))
      .rejects.toThrow("escaped project root");
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
    await expect(new AssetCompiler({ root, cacheDirectory: join(root, ".cache") }).register(invalid).compile("bad.kv"))
      .rejects.toThrow("loader output");
  });
});
