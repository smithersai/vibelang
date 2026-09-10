import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vectors from "../../../compiler/generator-row-vectors.json";
import { compileAndCheckVibeLang } from "./index.ts";

for (const vector of vectors.cases) test(`authored generator rows: ${vector.name}`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibelang-generator-row-"));
  try {
    const output = join(directory, "main.ts");
    const checked = compileAndCheckVibeLang(vectors.prelude + vector.source, {
      fileName: "main.vibe", outputFileName: output,
      runtimeImport: join(import.meta.dir, "../runtime/index.ts"),
    });
    if (vector.refuse) {
      const diagnostics = checked.result.analysis.diagnostics.filter(issue => issue.code === (vector.code ?? "VIBE1106"));
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain(vector.messageContains ?? "generator");
      expect(checked.ok).toBe(false);
      expect(checked.emitDiagnostics).toEqual([]);
    } else {
      expect(checked.result.analysis.diagnostics).toEqual([]);
      expect(checked.emitDiagnostics).toEqual([]);
      expect(checked.ok).toBe(true);
      await writeFile(output, checked.result.code);
      const program = await import(pathToFileURL(output).href);
      expect(await program.main()).toBe(vector.expected);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
