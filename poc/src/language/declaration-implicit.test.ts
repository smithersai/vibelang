import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { nativeTestJavaScript as javascript } from "../../test/native-transpile.ts";
import { analyzeProject, compileAndCheckProject, compileProject, emitProjectDeclarations } from "./index.ts";
import vectors from "../../../compiler/declaration-implicit-vectors.json";

const runtime = resolve(import.meta.dir, "../runtime/index.ts");

for (const vector of vectors.cases) test(`published implicit invocation: ${vector.name}`, async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-published-implicit-"));
  try {
    const name = `library-${vector.name}`;
    const producer = compileProject([{ fileName: `${name}.vibe`, source: `${vectors.prelude}\n${vector.declaration}` }], {
      rootDir: root, outDir: root, outputExtension: ".mjs", sourceMap: false, runtimeImport: runtime,
    });
    expect(producer.diagnostics).toEqual([]);
    const files = Object.values(producer.files);
    const declarations = emitProjectDeclarations(files.map(file => ({
      fileName: file.outputFileName, code: file.code, effects: file.analysis.rows, runtimeModule: runtime,
    })));
    expect(declarations.ok).toBe(true);
    expect(declarations.diagnostics).toEqual([]);
    expect(declarations.outputs.map(file => file.code).join("\n")).toContain('"requirements":["C"]');
    if (vector.requirementContracts !== undefined) {
      expect(declarations.outputs.map(file => file.code).join("\n").split('"requirements":["C"]').length - 1).toBe(vector.requirementContracts);
    }
    for (const file of declarations.outputs) await writeFile(file.fileName, file.code);
    for (const file of files) await writeFile(file.outputFileName, javascript(file.code));

    // No .vibe implementation is written to disk. These are the producer's
    // actual declarations, not hand-written contracts or a shared checker.
    const async = "async" in vector && vector.async;
    const prefix = `import * as lib from "./${name}.mjs";
import { Layer } from "vibelang/provider";
export ${async ? "async " : ""}function observe(): ${async ? "Promise<number>" : "number"} { ${vector.body} }`;
    const unprovided = compileProject([{ fileName: "unsupplied.vibe", source: prefix + `
export const answer = ${async ? "await " : ""}observe();` }], {
      rootDir: root, outDir: root, outputExtension: ".mjs", sourceMap: false, runtimeImport: runtime,
    });
    const pure = "pure" in vector && vector.pure;
    expect(unprovided.files["unsupplied.vibe"]?.analysis.rows.observe?.requirements).toEqual(pure ? [] : ["C"]);
    if (pure) expect(unprovided.diagnostics).toEqual([]);
    else expect(unprovided.diagnostics.map(issue => issue.code)).toContain("VIBE2102");

    const provided = compileAndCheckProject([{ fileName: "provided.vibe", source: prefix + `
export ${async ? "async " : ""}function main(): ${async ? "Promise<number>" : "number"} {
  return ${async ? "await " : ""}Layer.provide(Layer.succeed(lib.C, { value: () => 7 }), ${async ? "async " : ""}() => ${async ? "await " : ""}observe());
}` }], { rootDir: root, outDir: root, outputExtension: ".mjs", sourceMap: false, runtimeImport: runtime });
    if (vector.code) {
      expect(provided.result.diagnostics.map(issue => issue.code)).toContain(vector.code);
      expect(provided.ok).toBe(false);
      return;
    }
    expect(provided.result.diagnostics).toEqual([]);
    expect(provided.emitDiagnostics.map(issue => issue.message)).toEqual([]);
    expect(provided.ok).toBe(true);
    const file = provided.result.files["provided.vibe"]!;
    await writeFile(file.outputFileName, javascript(file.code));
    expect(await (await import(pathToFileURL(file.outputFileName).href)).main()).toBe(vector.value);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const vector of vectors.accessorMetadataCases) test(`invalid published accessor metadata: ${vector.name}`, async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-accessor-contract-"));
  try {
    await writeFile(join(root, "library.d.mts"), `/** @vibelangModule {"version":2,"runtimes":[]} */
export declare const resource: { /** @vibelangAccessor ${vector.payload} */ get value(): number };`);
    const analysis = analyzeProject([{ fileName: "main.vibe", source:
      'import { resource } from "./library.mjs"; export function main() { return { ...resource }.value }' }], { rootDir: root });
    expect(analysis.diagnostics.map(issue => issue.code)).toContain("VIBE1810");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("provided foreign declarations are copied without acquiring compiler-owned accessor claims", () => {
  const code = "export declare class Plain { get value(): number; }\n";
  const emitted = emitProjectDeclarations([{ fileName: "/virtual/library.d.mts", code }]);
  expect(emitted.ok).toBe(true);
  expect(emitted.diagnostics).toEqual([]);
  expect(emitted.outputs).toEqual([{ fileName: "/virtual/library.d.mts", code }]);
});

test("source authors cannot claim a runtime accessor is nonenumerable", () => {
  const analysis = analyzeProject([{ fileName: "main.vibe", source:
    'export const resource = { /** @vibelangAccessor {"version":1,"enumerable":false} */ get value() { return 1 } };' }]);
  expect(analysis.diagnostics.map(issue => issue.code)).toContain("VIBE1810");
});

for (const vector of [
  { name: "getter", declaration: "get value(): number;", body: "return resource.value" },
  { name: "iterator", declaration: "[Symbol.iterator](): Iterator<number>;", body: "let n = 0; for (const value of resource) n += value; return n" },
  { name: "disposer", declaration: "[Symbol.dispose](): void;", body: "{ using value = resource } return 0" },
]) test(`native ${vector.name} cannot drive an imported resumable convention`, async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-native-convention-"));
  try {
    await writeFile(join(root, "library.d.mts"), `/** @vibelangModule {"version":2,"runtimes":[]} */
export declare const resource: {
/** @vibelangEffects {"version":2,"failures":[],"requirements":["Clock"],"convention":"resumable"} */ ${vector.declaration}
};`);
    const analysis = analyzeProject([{ fileName: "main.vibe", source:
      `import { resource } from "./library.mjs"; export function main() { ${vector.body} }` }], { rootDir: root });
    // The native compiler refuses this convention at the published-contract
    // boundary, before any implicit invocation can acquire a callable row.
    expect(analysis.diagnostics.map(issue => issue.code)).toContain("VIBE1810");
    expect(analysis.diagnostics.some(issue => issue.message.includes("resumable calling convention"))).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
