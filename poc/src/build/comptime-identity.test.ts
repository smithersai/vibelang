import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { nativeTestJavaScript } from "../../test/native-transpile.ts";
import vectors from "../../../compiler/comptime-identity-vectors.json";
import { ComptimeCompiler } from "./comptime.ts";
import { compileComptimeIntrinsics } from "./comptime-intrinsic.ts";
import { comptimeValueHasAliases, decodeComptimeValue, encodeComptimeValue } from "./comptime-value.ts";
import { cloneJsonValue, digest } from "./stable.ts";
import { createSandboxedComptimeModule } from "./sandboxed-loader.ts";
import { compileAndCheckVibeLang } from "../language/validate.ts";

for (const vector of vectors.cases) {
  test(`comptime allocation identity: ${vector.name}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-comptime-identity-"));
    try {
      const source = `import { comptime } from "vibelang:comptime";
const value = comptime(() => { ${vector.body} })();
export function main() { return ${vector.observe}; }`;
      for (const warm of [false, true]) {
        const compiler = new ComptimeCompiler({ root, cacheDirectory: join(root, "cache") });
        const result = await compileComptimeIntrinsics({ compiler, sources: { "main.vibe": source } });
        expect(result.diagnostics).toEqual([]);
        expect(result.calls[0]!.build.cacheHit).toBe(warm);
        const observe = new Function("value", `return ${vector.observe};`);
        expect(observe(result.calls[0]!.value)).toBe(vector.expected);
        expect(observe(result.calls[0]!.build.value)).toBe(vector.expected);
        if (!warm) {
          const outputFileName = join(root, "checked.ts");
          const checked = compileAndCheckVibeLang(result.loweredSources!["main.vibe"]!, {
            fileName: "main.vibe", outputFileName,
            runtimeImport: join(import.meta.dir, "../runtime/index.ts"),
          });
          expect(checked.result.analysis.diagnostics).toEqual([]);
          expect(checked.emitDiagnostics).toEqual([]);
          await writeFile(outputFileName, checked.result.code);
          expect((await import(pathToFileURL(outputFileName).href)).main()).toBe(vector.expected);
        }
        const javascript = nativeTestJavaScript(result.loweredSources!["main.vibe"]!);
        const loaded = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
        expect(loaded.main()).toBe(vector.expected);
        const host = new Function(`const value = (() => { ${vector.body} })(); return ${vector.observe};`);
        expect(host()).toBe(vector.expected);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("data snapshots and graph transport preserve aliases without merging equal allocations", () => {
  const same = { z: 1, a: 2 };
  const value = { a: same, b: same, c: { z: 1, a: 2 } };
  for (const copied of [cloneJsonValue(value), decodeComptimeValue(JSON.parse(JSON.stringify(encodeComptimeValue(value))))] as typeof value[]) {
    expect(copied.a).toBe(copied.b);
    expect(copied.a).not.toBe(copied.c);
    expect(copied.a).not.toBe(same);
    expect(Object.keys(copied.a)).toEqual(["z", "a"]);
  }
  expect(comptimeValueHasAliases(encodeComptimeValue(value))).toBe(true);
  expect(comptimeValueHasAliases(encodeComptimeValue({ a: {}, b: {} }))).toBe(false);
});

test("alias layout participates in static cache identity and cannot be changed by a recomputed checksum", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-comptime-alias-cache-"));
  try {
    const options = { root, cacheDirectory: join(root, "cache") };
    const compiler = new ComptimeCompiler(options);
    const same = { n: 1 };
    const input = { a: same, b: same };
    const first = await compiler.evaluateStatic(input, { identity: "one caller" });
    const distinct = await compiler.evaluateStatic({ a: { n: 1 }, b: { n: 1 } }, { identity: "one caller" });
    expect(JSON.stringify(first.value)).toBe(JSON.stringify(distinct.value));
    expect(first.key).not.toBe(distinct.key);
    expect(first.logicalKey).not.toBe(distinct.logicalKey);
    const path = join(options.cacheDirectory, "comptime-objects", `${first.key}.json`);
    const envelope = JSON.parse(await readFile(path, "utf8"));
    envelope.build.value = encodeComptimeValue(distinct.value);
    envelope.outputDigest = digest(envelope.build);
    await writeFile(path, JSON.stringify(envelope));
    const restored = await new ComptimeCompiler(options).evaluateStatic<typeof input>(input, { identity: "one caller" });
    expect(restored.cacheHit).toBe(false);
    expect(restored.value.a).toBe(restored.value.b);
    const warm = await new ComptimeCompiler(options).evaluateStatic<typeof input>(input, { identity: "one caller" });
    expect(warm.cacheHit).toBe(true);
    expect(warm.value.a).toBe(warm.value.b);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const [name, graph] of [
  ["unknown version", { version: 2, nodes: [], root: 1 }],
  ["extra field", { version: 1, nodes: [], root: 1, extra: true }],
  ["dangling root", { version: 1, nodes: [], root: ["ref", 0] }],
  ["negative reference", { version: 1, nodes: [], root: ["ref", -1] }],
  ["cycle", { version: 1, nodes: [{ kind: "array", items: [["ref", 0]] }], root: ["ref", 0] }],
  ["forward reference", { version: 1, nodes: [{ kind: "array", items: [["ref", 1]] }, { kind: "array", items: [] }], root: ["ref", 0] }],
  ["unused definition", { version: 1, nodes: [{ kind: "array", items: [] }], root: null }],
  ["duplicate property", { version: 1, nodes: [{ kind: "object", entries: [["x", 1], ["x", 2]] }], root: ["ref", 0] }],
  ["noncanonical numeric order", { version: 1, nodes: [{ kind: "object", entries: [["10", 1], ["2", 2]] }], root: ["ref", 0] }],
  ["unknown node kind", { version: 1, nodes: [{ kind: "function", items: [] }], root: ["ref", 0] }],
  ["object in primitive position", { version: 1, nodes: [], root: {} }],
] as const) {
  test(`comptime graph refuses ${name}`, () => {
    expect(() => decodeComptimeValue(graph)).toThrow(TypeError);
  });
}

test("comptime graphs keep cycle, accessor, depth and expanded-size limits", () => {
  const cycle: unknown[] = []; cycle.push(cycle);
  expect(() => encodeComptimeValue(cycle)).toThrow("cyclic");
  expect(() => encodeComptimeValue({ get value() { throw new Error("must not invoke"); } })).toThrow("accessor");
  let deep: unknown = null;
  for (let index = 0; index < 520; index++) deep = [deep];
  expect(() => encodeComptimeValue(deep)).toThrow("too deep");
  let expanding: unknown = null;
  for (let index = 0; index < 20; index++) expanding = [expanding, expanding];
  expect(() => encodeComptimeValue(expanding)).toThrow("too large");
});

for (const vector of vectors.cases) {
  test(`sandboxed comptime allocation identity: ${vector.name}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-comptime-sandbox-identity-"));
    try {
      const modulePath = join(root, "value.mjs");
      await writeFile(modulePath, `export default () => { ${vector.body} }`);
      const module = createSandboxedComptimeModule({ id: "test:identity", version: "1", modulePath });
      const options = { root, cacheDirectory: join(root, "cache") };
      for (const warm of [false, true]) {
        const result = await new ComptimeCompiler(options).evaluate(module);
        expect(result.cacheHit).toBe(warm);
        expect(new Function("value", `return ${vector.observe};`)(result.value)).toBe(vector.expected);
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("sandboxed comptime arguments preserve aliases, normal object methods and cache distinctions", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-comptime-sandbox-args-"));
  try {
    const modulePath = join(root, "arguments.mjs");
    await writeFile(modulePath, `export default (left, right) => ({
      same: left === right, owns: left.hasOwnProperty("z"), left, right,
      keys: Object.keys(left), frozen: Object.isFrozen(left)
    })`);
    const module = createSandboxedComptimeModule({ id: "test:arguments", version: "1", modulePath });
    const options = { root, cacheDirectory: join(root, "cache") };
    const same = { z: 1, a: 2 };
    let sharedKey: string | undefined;
    for (const warm of [false, true]) {
      const shared = await new ComptimeCompiler(options).evaluate<{
        same: boolean; owns: boolean; frozen: boolean; left: typeof same; right: typeof same; keys: string[];
      }>(module, [same, same]);
      expect(shared.cacheHit).toBe(warm);
      expect(shared.value.same).toBe(true);
      expect(shared.value.owns).toBe(true);
      expect(shared.value.frozen).toBe(true);
      expect(shared.value.left).toBe(shared.value.right);
      expect(shared.value.keys).toEqual(["z", "a"]);
      sharedKey = shared.key;
    }
    const distinct = await new ComptimeCompiler(options).evaluate<{
      same: boolean; left: typeof same; right: typeof same;
    }>(module, [{ z: 1, a: 2 }, { z: 1, a: 2 }]);
    expect(distinct.cacheHit).toBe(false);
    expect(distinct.key).not.toBe(sharedKey);
    expect(distinct.value.same).toBe(false);
    expect(distinct.value.left).not.toBe(distinct.value.right);
  } finally { await rm(root, { recursive: true, force: true }); }
});
