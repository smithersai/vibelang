import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getNativeCompiler } from "../compiler/native.ts";
import { nativeTestJavaScript } from "../../test/native-transpile.ts";
import { analyzeProject } from "./analyze.ts";
import { annotateDeclarationEffects, normalizeDeclarationEffectChannels, readDeclarationEffects } from "./declarations.ts";

const row = { failures: [], requirements: ["Clock"] };
const valid = '{"version":2,"failures":[],"requirements":["Clock"],"convention":"eager"}';
const module = '/** @vibelangModule {"version":2,"runtimes":[]} */\n';

for (const [name, payload] of [
  ["unknown version", valid.replace('"version":2', '"version":999')],
  ["missing convention", '{"version":2,"failures":[],"requirements":["Clock"]}'],
  ["wrong convention", valid.replace('"eager"', '"guess"')],
  ["duplicate field", valid.replace('"version":2', '"version":2,"version":2')],
  ["unknown field", valid.replace('"version":2', '"version":2,"ignored":true')],
  ["unsorted requirements", valid.replace('["Clock"]', '["Random","Clock"]')],
  ["duplicate requirement", valid.replace('["Clock"]', '["Clock","Clock"]')],
  ["wrong requirement type", valid.replace('["Clock"]', '[1]')],
  ["noncanonical JSON", valid.replace('"version":2', '"version": 2')],
  ["malformed JSON", '{"version":2'],
] as const) {
  test(`a published ${name} is a source diagnostic, not an empty row`, async () => {
    const root = await mkdtemp(join(tmpdir(), "vibelang-bad-declaration-"));
    try {
      await writeFile(join(root, "library.d.mts"), `${module}/** @vibelangEffects ${payload} */\nexport declare function read(): number;`);
      const analysis = analyzeProject([{ fileName: "main.vibe", source: 'import { read } from "./library.mjs"; export function main() { return read() }' }], { rootDir: root });
      expect(analysis.diagnostics.some(issue => issue.code === "VIBE1810" && issue.fileName === "main.vibe")).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("version 1 remains inspectable but cannot masquerade as a readable current calling convention", async () => {
  const code = '/** @vibelangEffects {"version":1,"failures":[],"requirements":["Clock"]} */\nexport declare function read(): number;';
  expect(readDeclarationEffects(code)).toEqual({ read: row });
  const root = await mkdtemp(join(tmpdir(), "vibelang-old-declaration-"));
  try {
    await writeFile(join(root, "library.d.mts"), module + code);
    const analysis = analyzeProject([{ fileName: "main.vibe", source: 'import { read } from "./library.mjs"; export function main() { return read() }' }], { rootDir: root });
    expect(analysis.diagnostics.some(issue => issue.code === "VIBE1810")).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("native analysis links Go runtime envelopes and retains their requirement rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-go-declaration-"));
  try {
    const header = '/** @vibelangModule {"version":3,"runtimes":["./__vibelang_prelude.js"],"runtimeABI":"vibelang-go-eager@1"} */ ';
    const code = `${header}/** @vibelangEffects ${valid} */ export declare function read(): number;`;
    await writeFile(join(root, "library.d.mts"), code);
    const source = 'import { read } from "./library.mjs"; export function main() { return read() }';
    const analyzeGo = () => getNativeCompiler().analyzeLanguage({
      files: [{ path: "main.vibe", kind: "vibelang", text: source }], resolutionRoot: root,
    });
    const analysis = analyzeGo();
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.checked).toBe(true);
    expect(analysis.files[0]!.functions.find(fn => fn.name === "main")?.requirements).toEqual(["Clock"]);
    // Both targets use Go, but their runtime ABIs are deliberately distinct.
    // A standalone-prelude contract cannot certify an SDK-environment call.
    const sdk = analyzeProject([{ fileName: "main.vibe", source }], { rootDir: root });
    expect(sdk.diagnostics.some(issue => issue.code === "VIBE1810" && issue.message.includes("runtime ABI"))).toBe(true);
    await writeFile(join(root, "library.d.mts"), code.replace("vibelang-go-eager@1", "vibelang-js@1"));
    const incompatible = analyzeGo();
    expect(incompatible.checked).toBe(false);
    expect(incompatible.diagnostics.some(issue => issue.code === "VIBE1810" && issue.file === "main.vibe" && issue.message.includes("runtime ABI"))).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("duplicate callable tags are refused even when they are separate JSDoc comments", () => {
  const code = `/** @vibelangEffects ${valid} */\n/** @vibelangEffects ${valid} */\nexport declare function read(): number;`;
  expect(() => readDeclarationEffects(code)).toThrow("exactly one effect metadata tag");
});

test("source authors cannot mint compiler callable contracts", () => {
  const analysis = analyzeProject([{ fileName: "main.vibe", source: `/** @vibelangEffects ${valid} */\nexport function main() { return 1 }` }]);
  expect(analysis.diagnostics.some(issue => issue.code === "VIBE1810")).toBe(true);
});

for (const source of [
  'import { Context } from "vibelang:declaration-types"; export class C extends Context {}',
  'import type { Result } from "vibelang:declaration-types";',
  'export { Context } from "vibelang:declaration-types";',
  'export type R = import("vibelang:declaration-types").Result<number, never>;',
  'export async function load() { return await import("vibelang:declaration-types"); }',
  '/** @vibelangRequirements */\nexport type Table = {};',
  '/** @vibelangModule {"version":2,"runtimes":[]} */\nexport function f() { return 1; }',
]) test(`compiler declaration machinery is not authorable: ${source.split("\n")[0]}`, () => {
  const analysis = analyzeProject([{ fileName: "main.vibe", source }]);
  expect(analysis.diagnostics.some(issue => issue.code === "VIBE1810")).toBe(true);
});

test("native publication preserves anonymous-callable tags and consumers retain their rows", async () => {
  const source = `export declare function factory(): /** @vibelangEffects ${valid} */ () => number;`;
  const published = annotateDeclarationEffects(source, { factory: { failures: [], requirements: [] } });
  expect(published).toContain(module.trim());
  expect(published).toContain(`factory(): /** @vibelangEffects ${valid} */ () => number;`);
  const root = await mkdtemp(join(tmpdir(), "vibelang-nested-declaration-"));
  try {
    await writeFile(join(root, "library.d.mts"), published);
    const analysis = analyzeProject([{ fileName: "main.vibe", source: 'import { factory } from "./library.mjs"; export function main() { const read = factory(); return read() }' }], { rootDir: root });
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.files["main.vibe"]!.rows.main?.requirements).toEqual(["Clock"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("ordinary similarly-spelled imports receive no compiler channel normalization", () => {
  const source = 'import { Result, Context } from "runtime"; export declare function read(): Result<number, Error>;';
  expect(normalizeDeclarationEffectChannels(source, { read: { failures: ["Error"], requirements: [] } }, "foreign.d.mts", [])).toBe(source);
  expect(readDeclarationEffects(source)).toEqual({});
});

test("metadata accepts the compiler's Unicode names, escaped qualifiers and Action identities", () => {
  const row = { failures: ["Échec@hello+0020world", "错误"], requirements: ["cart with #hash.vibe#动作", "Clock"] };
  const published = annotateDeclarationEffects("export declare function read(): number;", { read: row });
  expect(readDeclarationEffects(published).read).toEqual({
    failures: [...row.failures].sort(), requirements: [...row.requirements].sort(),
  });
});

test("an empty row cannot declare a resumable ABI", () => {
  expect(() => readDeclarationEffects('/** @vibelangEffects {"version":2,"failures":[],"requirements":[],"convention":"resumable"} */\nexport declare function read(): number;')).toThrow("empty effect row");
});

test("metadata cannot terminate its compiler comment or introduce a return-line terminator", async () => {
  const row = { failures: [], requirements: ["path*/next\u2028part.vibe#Action"] };
  const published = annotateDeclarationEffects("export declare function read(): number;", { read: row });
  const encoded = published.match(/@vibelangEffects (\{[^\n]+\}) \*\//)![1]!;
  expect(encoded).not.toContain("*/");
  expect(encoded).not.toContain("\u2028");
  expect(readDeclarationEffects(published).read).toEqual(row);
  const javascript = nativeTestJavaScript(`export function factory() { return /** @vibelangEffects ${encoded} */ () => 1 }`);
  const loaded = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
  expect(typeof loaded.factory()).toBe("function");
  expect(loaded.factory()()).toBe(1);
});
