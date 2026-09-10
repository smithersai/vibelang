import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssetCompiler } from "./assets.ts";
import { ComptimeCompiler } from "./comptime.ts";
import { createSandboxedComptimeModule } from "./sandboxed-loader.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-input-observer-")));
  roots.push(root);
  const seen = new Set<string>();
  const options = { root, cacheDirectory: join(root, ".cache"), onDependency: (file: string) => { seen.add(file); } };
  const write = (name: string, text: string) => { const file = join(root, name); writeFileSync(file, text); return file; };
  return { root, seen, options, write };
}

for (const Compiler of [AssetCompiler, ComptimeCompiler]) {
  test(`${Compiler.name} rejects non-callable input observers`, () => {
    const p = project();
    expect(() => new Compiler({ ...p.options, onDependency: true as never })).toThrow("observer must be a function");
  });
}

test("asset input observers report cold and warm inputs without changing content identity", async () => {
  const p = project();
  const file = p.write("input.txt", "before");
  const compiler = new AssetCompiler(p.options);
  const cold = await compiler.compile("input.txt", { type: "text" });
  expect(p.seen.has(file)).toBe(true);
  p.seen.clear();
  const warm = await compiler.compile("input.txt", { type: "text" });
  expect(warm.cacheHit).toBe(true);
  expect(p.seen.has(file)).toBe(true);
  const ordinary = await new AssetCompiler({ root: p.root, cacheDirectory: p.options.cacheDirectory }).compile("input.txt", { type: "text" });
  expect(ordinary.key).toBe(cold.key);
  expect(ordinary.module).toEqual(cold.module);
  p.write("input.txt", "after");
  const changed = await compiler.compile("input.txt", { type: "text" });
  expect(changed.cacheHit).toBe(false);
  expect(changed.key).not.toBe(cold.key);
});

test("asset refusal reports the absent in-root candidate, never an escaped candidate", async () => {
  const p = project();
  mkdirSync(join(p.root, "nested"));
  const compiler = new AssetCompiler(p.options);
  await expect(compiler.compile("nested/missing.txt", { type: "text" })).rejects.toThrow();
  expect(p.seen.has(join(p.root, "nested/missing.txt"))).toBe(true);
  p.seen.clear();
  await expect(compiler.compile("../outside.txt", { type: "text" })).rejects.toThrow();
  expect(p.seen.size).toBe(0);
});

test("static comptime input observers report failures and cache revalidation", async () => {
  const p = project();
  p.write("main.vibe", "export {};");
  const entry = "main.vibe";
  const input = p.write("input.txt", "before");
  const compiler = new ComptimeCompiler(p.options);
  const snapshot = compiler.readTrackedText("./input.txt", { from: entry });
  expect(p.seen.has(input)).toBe(true);
  const options = { identity: "watch-test", dependencies: [snapshot.dependency] };
  await compiler.evaluateStatic(snapshot.value, options);
  p.seen.clear();
  expect((await compiler.evaluateStatic(snapshot.value, options)).cacheHit).toBe(true);
  expect(p.seen.has(input)).toBe(true);
  expect(() => compiler.readTrackedText("./missing.txt", { from: entry })).toThrow();
  expect(p.seen.has(join(p.root, "missing.txt"))).toBe(true);
});

test("sandboxed comptime reports inputs even on warm-cache revalidation", async () => {
  const p = project();
  const input = p.write("input.txt", "watched");
  const modulePath = p.write("derive.mjs", 'export default async context => await context.readText("./input.txt");');
  const module = createSandboxedComptimeModule({ id: "test:watch-input", version: "1", modulePath });
  const compiler = new ComptimeCompiler(p.options);
  expect((await compiler.evaluate(module)).value).toBe("watched");
  p.seen.clear();
  const warm = await compiler.evaluate(module);
  expect(warm.cacheHit).toBe(true);
  expect(p.seen.has(input)).toBe(true);
});

test("catching a missing sandbox dependency cannot publish a cached fallback", async () => {
  const p = project();
  const modulePath = p.write("derive.mjs", 'export default async context => {try{return await context.readText("./missing.txt");}catch{return "fallback";}};');
  const module = createSandboxedComptimeModule({ id: "test:missing-watch-input", version: "1", modulePath });
  const compiler = new ComptimeCompiler(p.options);
  await expect(compiler.evaluate(module)).rejects.toThrow("dependency request failed");
  expect(p.seen.has(join(p.root, "missing.txt"))).toBe(true);
  p.write("missing.txt", "created");
  const recovered = await compiler.evaluate(module);
  expect(recovered.cacheHit).toBe(false);
  expect(recovered.value).toBe("created");
});
