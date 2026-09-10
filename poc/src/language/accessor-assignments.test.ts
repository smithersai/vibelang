import { expect, test } from "bun:test";
import corpus from "../../../compiler/accessor-assignment-vectors.json";
import { analyzeSource } from "./analyze.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { nativeTestJavaScript as javascript } from "../../test/native-transpile.ts";
import { compileProject, compileAndCheckProject, emitProjectDeclarations } from "./index.ts";

for (const vector of corpus.cases) {
  test(`accessor assignment: ${vector.name}`, () => {
    const result = analyzeSource(corpus.head + vector.body);
    if (vector.accepted) expect(result.diagnostics).toEqual([]);
    else {
      const code = "code" in vector ? vector.code : "VIBE1808";
      expect(result.diagnostics.some(issue => issue.code === code && (code !== "VIBE1808" || /C|D/.test(issue.message)))).toBe(true);
      if ("count" in vector) expect<number | undefined>(result.diagnostics.filter(issue => issue.code === code).length).toBe(vector.count);
    }
  });
}

for (const vector of corpus.published.cases) test(`accessor assignment: ${vector.name}`, async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-accessor-assignment-"));
  const runtime = resolve(import.meta.dir, "../runtime/index.ts");
  const options = { rootDir: root, outDir: root, outputExtension: ".mjs" as const, sourceMap: false, runtimeImport: runtime };
  try {
    const producer = compileProject([{ fileName: "library.vibe", source: corpus.published.source }], options);
    expect(producer.diagnostics).toEqual([]);
    const files = Object.values(producer.files);
    const declarations = emitProjectDeclarations(files.map(file => ({
      fileName: file.outputFileName, code: file.code, effects: file.analysis.rows, runtimeModule: runtime,
    })));
    expect(declarations.diagnostics).toEqual([]);
    expect(declarations.ok).toBe(true);
    for (const file of declarations.outputs) await writeFile(file.fileName, file.code);
    for (const file of files) await writeFile(file.outputFileName, javascript(file.code));
    const consumer = compileAndCheckProject([{ fileName: "main.vibe", source:
      'import * as lib from "./library.mjs"; import { Layer } from "vibelang/provider";\n' + vector.body }], options);
    if (!vector.accepted) {
      expect(consumer.ok).toBe(false);
      expect(consumer.result.diagnostics.some(issue => issue.code === "VIBE1808")).toBe(true);
    } else {
      expect(consumer.result.diagnostics).toEqual([]);
      expect(consumer.emitDiagnostics).toEqual([]);
      expect(consumer.ok).toBe(true);
      const file = consumer.result.files["main.vibe"]!;
      await writeFile(file.outputFileName, javascript(file.code));
      expect((await import(pathToFileURL(file.outputFileName).href)).main()).toBe(7);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
