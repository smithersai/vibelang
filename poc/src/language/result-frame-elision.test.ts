import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vectors from "../../../compiler/result-frame-elision-vectors.json";
import { compileAndCheckVibeLang } from "./index.ts";

for (const vector of vectors.cases) test(`Result frame elision: ${vector.name}`, async () => {
  const directory = await mkdtemp(join(tmpdir(), "vibelang-result-frame-"));
  try {
    const output = join(directory, vector.name.replace(/\W+/gu, "-") + ".ts");
    const checked = compileAndCheckVibeLang(vectors.prelude + vector.source, {
      fileName: output.replace(/\.ts$/u, ".vibe"), outputFileName: output,
      runtimeImport: join(import.meta.dir, "../runtime/index.ts"),
    });
    if (vector.refuse) {
      expect(checked.ok).toBe(false);
      // Native compilation now reports type errors before SDK intermediate emit.
      expect([...checked.result.analysis.diagnostics, ...checked.emitDiagnostics].map(issue => issue.code)).toContain(vector.goRefuse ?? vector.refuse);
      return;
    }
    expect(checked.result.analysis.diagnostics).toEqual([]);
    expect(checked.emitDiagnostics).toEqual([]);
    expect(checked.ok).toBe(true);
    // The SDK target uses the native eager-call convention too. Capability
    // reads by themselves need no generator frame; the execution stays pinned.
    expect<boolean | undefined>(/__vsRunResult(?:Async)?\(/u.test(checked.result.code)).toBe(vector.goDelimiter);
    await writeFile(output, checked.result.code);
    const program = await import(pathToFileURL(output).href);
    if (vector.foreign) {
      // An unchecked host violates the entry's parameter contract. The source
      // still has to check; no cast or compiler-owned constructor bypasses it.
      let answer: string;
      try { answer = String((await program.main()).unwrapOr(0)); }
      catch (error) { answer = error instanceof Error ? error.message : "not-error"; }
      if (program.trace) answer += `,${program.trace()}`;
      expect(answer).toBe(vector.expected);
    } else expect(await program.main()).toBe(vector.expected);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
