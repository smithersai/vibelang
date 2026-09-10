import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vectors from "../../../compiler/layer-scope-vectors.json";
import { compileAndCheckVibeLang } from "./validate.ts";

const workspace = mkdtempSync(join(tmpdir(), "vibelang-layer-scope-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

for (const [index, vector] of vectors.cases.entries()) test(`Layer scope: ${vector.name}`, async () => {
  const output = join(workspace, `${index}.ts`);
  const checked = compileAndCheckVibeLang(vectors.head + vector.body, {
    fileName: `${output}.vibe`, outputFileName: output,
    runtimeImport: join(import.meta.dir, "../runtime/index.ts"),
  });
  if (vector.code) {
    expect(checked.result.analysis.diagnostics.map(issue => issue.code)).toContain(vector.code);
    return;
  }
  expect(checked.result.analysis.diagnostics).toEqual([]);
  expect(checked.emitDiagnostics).toEqual([]);
  writeFileSync(output, checked.result.code);
  const program = await import(pathToFileURL(output).href);
  expect(await program.main()).toEqual(vector.output);
});
