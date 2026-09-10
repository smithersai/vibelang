import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeTestJavaScript } from "../../test/native-transpile.ts";
import vectors from "../../../compiler/comptime-order-vectors.json";
import { ComptimeCompiler } from "./comptime.ts";
import { compileComptimeIntrinsics } from "./comptime-intrinsic.ts";
import { createSandboxedComptimeModule } from "./sandboxed-loader.ts";
import { canonical, cloneJsonValue, digest } from "./stable.ts";
import { encodeComptimeValue } from "./comptime-value.ts";

for (const vector of vectors.cases) {
  test(`comptime order: ${vector.name}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-comptime-order-"));
    try {
      const source = `import { comptime } from "vibelang:comptime";
const value = comptime(() => ${vector.expression})();
export function main(): string {
  const runtime = ${vector.expression};
  return [${vector.observation}, ${vector.observation.replaceAll("value", "runtime")}].join("|");
}`;
      for (const warm of [false, true]) {
        const compiler = new ComptimeCompiler({ root, cacheDirectory: join(root, ".cache") });
        const result = await compileComptimeIntrinsics({ compiler, sources: { "main.ts": source } });
        expect(result.diagnostics).toEqual([]);
        if (!result.loweredSources) throw new Error("comptime did not emit lowered sources");
        expect(result.calls[0]!.build.cacheHit).toBe(warm);
        const js = nativeTestJavaScript(result.loweredSources["main.ts"]!);
        const loaded = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
        expect(loaded.main()).toBe(`${vector.expected}|${vector.expected}`);
        const observe = new Function("value", `return ${vector.observation}`);
        expect(observe(result.calls[0]!.value)).toBe(vector.expected);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("program value order participates in static cache identity and integrity", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-comptime-order-cache-"));
  try {
    const cacheDirectory = join(root, ".cache");
    const compiler = new ComptimeCompiler({ root, cacheDirectory });
    const options = { identity: "same caller" };
    const first = await compiler.evaluateStatic({ z: 1, a: 2 }, options);
    const reordered = await compiler.evaluateStatic({ a: 2, z: 1 }, options);
    expect(first.key).not.toBe(reordered.key);
    expect(first.logicalKey).not.toBe(reordered.logicalKey);
    expect(canonical(first.value)).toBe(canonical(reordered.value)); // Metadata remains canonical.
    const path = join(cacheDirectory, "comptime-objects", `${first.key}.json`);
    const envelope = JSON.parse(await readFile(path, "utf8"));
    envelope.build.value = encodeComptimeValue(reordered.value);
    // Even a recomputed output checksum cannot change the pinned cache key.
    envelope.outputDigest = digest(envelope.build);
    await writeFile(path, JSON.stringify(envelope));
    const restored = await new ComptimeCompiler({ root, cacheDirectory }).evaluateStatic({ z: 1, a: 2 }, options);
    expect(restored.cacheHit).toBe(false);
    if (!restored.value || typeof restored.value !== "object") throw new Error("expected an object value");
    expect(Object.keys(restored.value)).toEqual(["z", "a"]);
    const warm = await new ComptimeCompiler({ root, cacheDirectory }).evaluateStatic({ z: 1, a: 2 }, options);
    expect(warm.cacheHit).toBe(true);
    if (!warm.value || typeof warm.value !== "object") throw new Error("expected an object value");
    expect(Object.keys(warm.value)).toEqual(["z", "a"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("order-preserving snapshots retain the existing data validation", () => {
  for (const invalid of [NaN, -0, [, 1], { get x() { throw new Error("getter must not run"); } }, new Date(0)]) {
    expect(() => cloneJsonValue(invalid)).toThrow(TypeError);
  }
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  expect(() => cloneJsonValue(cyclic)).toThrow(TypeError);
  let invoked = false;
  const array: unknown[] = [1];
  Object.defineProperty(array, "0", { enumerable: true, get() { invoked = true; return 1; } });
  expect(() => cloneJsonValue(array)).toThrow(TypeError);
  expect(invoked).toBe(false);
});

test("sandbox comptime preserves argument and result order across a cache reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-comptime-order-sandbox-"));
  try {
    const modulePath = join(root, "order.mjs");
    await writeFile(modulePath, `export default input => ({ z: input, a: Object.keys(input) })`);
    const module = createSandboxedComptimeModule({ id: "test:ordered-comptime", version: "1", modulePath });
    const options = { root, cacheDirectory: join(root, ".cache") };
    const first = await new ComptimeCompiler(options).evaluate(module, [{ z: 1, a: 2 }]);
    expect(JSON.stringify(first.value)).toBe('{"z":{"z":1,"a":2},"a":["z","a"]}');
    const warm = await new ComptimeCompiler(options).evaluate(module, [{ z: 1, a: 2 }]);
    expect(warm.cacheHit).toBe(true);
    expect(JSON.stringify(warm.value)).toBe(JSON.stringify(first.value));
    const other = await new ComptimeCompiler(options).evaluate(module, [{ a: 2, z: 1 }]);
    expect(other.cacheHit).toBe(false);
    expect(other.key).not.toBe(first.key);
    expect(JSON.stringify(other.value)).toBe('{"z":{"a":2,"z":1},"a":["a","z"]}');
  } finally { await rm(root, { recursive: true, force: true }); }
});
