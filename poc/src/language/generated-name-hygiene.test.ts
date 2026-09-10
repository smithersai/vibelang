import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vectors from "../../../compiler/generated-name-hygiene-vectors.json";
import { compileAndCheckVibeLang } from "./index.ts";

for (const vector of vectors.cases) test(`generated-name hygiene: ${vector.name}`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibelang-name-hygiene-"));
  try {
    const output = join(directory, `hygiene-${vector.name.replace(/\W+/gu, "-")}.ts`);
    const checked = compileAndCheckVibeLang(vectors.prelude + vector.source, {
      fileName: output.replace(/\.ts$/u, ".vibe"), outputFileName: output,
      runtimeImport: join(import.meta.dir, "../runtime/index.ts"),
    });
    expect(checked.result.analysis.diagnostics).toEqual([]);
    expect(checked.emitDiagnostics).toEqual([]);
    expect(checked.ok).toBe(true);
    await writeFile(output, checked.result.code);
    const program = await import(pathToFileURL(output).href);
    expect(await program.main()).toBe(vector.expected);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
