import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vectors from "../../../compiler/disposal-protocol-vectors.json";
import { analyzeSource, compileAndCheckProject, compileAndCheckVibeLang } from "./index.ts";

for (const [index, vector] of vectors.cases.entries()) test(`disposal protocol: ${vector.name}`, async () => {
  const source = vectors.prelude + vector.source;
  const fileName = `disposal-protocol-${index}.vibe`;
  const analysis = analyzeSource(source, { fileName });
  if ("requirements" in vector) expect<unknown>(analysis.rows.f?.requirements).toEqual(vector.requirements);
  if ("code" in vector) {
    expect<readonly (string | undefined)[]>(analysis.diagnostics.map(diagnostic => diagnostic.code)).toContain(vector.code);
    return;
  }
  expect(analysis.diagnostics).toEqual([]);
  const directory = await mkdtemp(join(tmpdir(), "vibelang-disposal-protocol-"));
  try {
    const output = join(directory, fileName.replace(/\.vibe$/u, ".ts"));
    const checked = compileAndCheckVibeLang(source, {
      fileName, outputFileName: output, runtimeImport: join(import.meta.dir, "../runtime/index.ts"),
    });
    expect(checked.result.analysis.diagnostics).toEqual([]);
    expect(checked.emitDiagnostics).toEqual([]);
    expect(checked.ok).toBe(true);
    await writeFile(output, checked.result.code);
    const program = await import(pathToFileURL(output).href);
    expect(await program.main()).toBe(vector.expected);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const vector of vectors.foreignCases) test(`disposal protocol: ${vector.name}`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibelang-disposal-foreign-"));
  try {
    await writeFile(join(directory, "foreign.ts"), vectors.foreign);
    const checked = compileAndCheckProject([{ fileName: join(directory, "resource.vibe"), source: vector.source }], {
      rootDir: directory, outDir: join(directory, "out"), runtimeImport: join(import.meta.dir, "../runtime/index.ts"),
    });
    expect(checked.ok).toBe(false);
    expect(checked.result.diagnostics.map(diagnostic => diagnostic.code)).toContain("VIBE1506");
    expect(Object.values(checked.result.files)[0]?.analysis.rows.f?.failures).toEqual(["Panic"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
