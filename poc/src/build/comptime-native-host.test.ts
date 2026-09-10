import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getNativeCompiler } from "../compiler/native.ts";
import { ComptimeCompiler } from "./comptime.ts";
import { compileComptimeIntrinsics } from "./comptime-intrinsic.ts";

beforeAll(() => { getNativeCompiler(); }, 60_000);
const roots: string[] = [];
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "vibelang-native-comptime-host-"));
  roots.push(root);
  const compiler = new ComptimeCompiler({ root, cacheDirectory: join(root, ".cache"), target: "test" });
  return { root, compiler };
}

test("native input discovery follows reached paths and attaches dependencies only to their consuming call", async () => {
  const { root, compiler } = await setup();
  const source = `import {comptime,embed} from "vibelang:comptime";
export const first=comptime(()=>embed(embed("./name.txt")))();
export const second=comptime(()=>comptime.target==="test"?embed("./independent.txt"):embed("./unselected.txt"))();`;
  await writeFile(join(root, "main.vibe"), source);
  await writeFile(join(root, "name.txt"), "./value.txt");
  await writeFile(join(root, "value.txt"), "42");
  await writeFile(join(root, "independent.txt"), "other");
  const compile = () => compileComptimeIntrinsics({ compiler, sources: { "main.vibe": source } });
  const first = await compile();
  expect(first.diagnostics).toEqual([]);
  expect(first.calls.map(call => call.value)).toEqual(["42", "other"]);
  expect(first.calls.map(call => call.build.dependencies.map(dependency => dependency.path)))
    .toEqual([["name.txt", "value.txt"], ["independent.txt"]]);
  const warm = await compile();
  expect(warm.calls.map(call => call.build.cacheHit)).toEqual([true, true]);
  await writeFile(join(root, "value.txt"), "43");
  const changed = await compile();
  expect(changed.calls.map(call => call.value)).toEqual(["43", "other"]);
  expect(changed.calls.map(call => call.build.cacheHit)).toEqual([false, true]);
  expect(changed.calls[1]!.build.key).toBe(first.calls[1]!.build.key);
});

test("a retained imported helper cannot borrow phase-only authority from its caller", async () => {
  const { root, compiler } = await setup();
  const main = `import {comptime} from "vibelang:comptime";import {read} from "./data/input.vibe";export const value=comptime(()=>read())();`;
  const input = `// 🐱\r\nimport {embed} from "vibelang:comptime";export function read(){return embed("./value.txt")}`;
  await mkdir(join(root, "data"));
  await writeFile(join(root, "main.vibe"), main);
  await writeFile(join(root, "data/input.vibe"), input);
  await writeFile(join(root, "data/value.txt"), "42");
  // A retained runtime function cannot acquire an erased compiler-only input,
  // even when invoked from an erased inline function in another module.
  const refused = await compileComptimeIntrinsics({ compiler, sources: { "main.vibe": main, "data/input.vibe": input } });
  expect(refused.ok).toBe(false);
  expect(refused.diagnostics.some(issue => issue.file === "data/input.vibe" && issue.code === "VCT1006")).toBe(true);
  expect(existsSync(join(root, ".cache"))).toBe(false);
});

test("native phase does not acquire filesystem authority through path aliases", async () => {
  const { root, compiler } = await setup();
  const outside = await setup();
  await writeFile(join(outside.root, "secret.txt"), "outside");
  await symlink(join(outside.root, "secret.txt"), join(root, "linked.txt"));
  for (const specifier of [join(outside.root, "secret.txt"), "./linked.txt", "./absent.txt"]) {
    const source = `import {comptime,embed} from "vibelang:comptime";const value=comptime(embed(${JSON.stringify(specifier)}));`;
    await writeFile(join(root, "main.vibe"), source);
    const result = await compileComptimeIntrinsics({ compiler, sources: { "main.vibe": source } });
    expect(result.ok).toBe(false);
    expect(result.calls).toEqual([]);
    expect(result.loweredFiles).toBeUndefined();
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "VCT1004", file: "main.vibe" })]);
    expect(existsSync(join(root, ".cache"))).toBe(false);
  }
});

test("erased inline callbacks retain tracked input authority and imported call provenance", async () => {
  const { root, compiler } = await setup();
  const main = `import {answer} from "./data/input.vibe";export {answer};`;
  const input = `// 🐱\r\nimport {comptime,embed} from "vibelang:comptime";export const answer=comptime(()=>[0].map(value=>embed("./value.txt"))[0])();`;
  await mkdir(join(root, "data"));
  await writeFile(join(root, "main.vibe"), main);
  await writeFile(join(root, "data/input.vibe"), input);
  await writeFile(join(root, "data/value.txt"), "42");
  const result = await compileComptimeIntrinsics({ compiler, sources: { "main.vibe": main, "data/input.vibe": input } });
  expect(result.diagnostics).toEqual([]);
  expect(result.calls[0]!.value).toBe("42");
  expect(result.calls[0]!.file).toBe("data/input.vibe");
  expect(result.calls[0]!.start).toBe(input.indexOf("comptime(()"));
  expect(result.calls[0]!.build.dependencies.map(dependency => dependency.path)).toEqual(["data/value.txt"]);
  const edit = result.loweredFiles!["data/input.vibe"]!.provenance.edits.find(edit => edit.kind === "intrinsic-call")!;
  expect(edit.origins.some(origin => origin.file === "data/input.vibe" && input.slice(origin.start, origin.end) === 'embed("./value.txt")')).toBe(true);
});

test("source closure identity invalidates a native phase cache even when the value is unchanged", async () => {
  const { compiler } = await setup();
  const sources = { "main.ts": `import {comptime} from "vibelang:comptime";import {value} from "./data.js";export const answer=comptime(value);`,
    "data.ts": "export const value=42;" };
  const first = await compileComptimeIntrinsics({ compiler, sources });
  const warm = await compileComptimeIntrinsics({ compiler, sources });
  expect(first.diagnostics).toEqual([]);
  expect(warm.calls[0]!.build.cacheHit).toBe(true);
  sources["data.ts"] += "\n// changed implementation input";
  const changed = await compileComptimeIntrinsics({ compiler, sources });
  expect(changed.diagnostics).toEqual([]);
  expect(changed.calls[0]!.value).toBe(42);
  expect(changed.calls[0]!.build.cacheHit).toBe(false);
  expect(changed.calls[0]!.build.key).not.toBe(first.calls[0]!.build.key);
  expect(changed.loweredSources!["main.ts"]).toBe(first.loweredSources!["main.ts"]);
  expect(changed.loweredFiles!["main.ts"]!.identity).not.toBe(first.loweredFiles!["main.ts"]!.identity);
  expect(first.loweredFiles!["main.ts"]!.provenance.frontend).toBe("vibelang-comptime-native@1");
});

test("native phase cache and execution preserve lone UTF16 units and shared allocations", async () => {
  const { compiler } = await setup();
  const source = String.raw`import {comptime} from "vibelang:comptime";
export const value=comptime(()=>{const shared={lone:"\ud800",literal:"\\ud83d",low:"😀".slice(1)};return {z:shared,a:shared}})();`;
  for (const cacheHit of [false, true]) {
    const result = await compileComptimeIntrinsics({ compiler, sources: { "main.js": source } });
    expect(result.diagnostics).toEqual([]);
    expect(result.calls[0]!.build.cacheHit).toBe(cacheHit);
    const cached = result.calls[0]!.value as { z: unknown; a: unknown };
    expect(cached.z).toBe(cached.a);
    const loaded = await import(`data:text/javascript;base64,${Buffer.from(result.loweredSources!["main.js"]!).toString("base64")}`);
    expect(Object.keys(loaded.value)).toEqual(["z", "a"]);
    expect(loaded.value.z).toBe(loaded.value.a);
    expect(loaded.value.z).toEqual({ lone: "\ud800", literal: "\\ud83d", low: "\ude00" });
  }
});
