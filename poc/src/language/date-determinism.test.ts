import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compileAndCheckVibeLang } from "./validate.ts";
import { compileDurableBody } from "../durable/body-compiler.ts";

const workspace = mkdtempSync(join(tmpdir(), "vibelang-date-zones-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));
const vectors: { name: string; body: string; output?: string[] }[] = JSON.parse(readFileSync(
  join(import.meta.dir, "../../../compiler/date-determinism-vectors.json"), "utf8")).cases;

for (const [index, vector] of vectors.entries()) test(`Date determinism: ${vector.name}`, async () => {
  const output = join(workspace, `${index}.ts`);
  const checked = compileAndCheckVibeLang(`export function main(): string[] { ${vector.body} }`, {
    fileName: `${output}.vibe`, outputFileName: output, runtimeImport: join(import.meta.dir, "../runtime/index.ts"),
  });
  if (!vector.output) {
    expect(checked.result.analysis.diagnostics.map(issue => issue.code)).toEqual(["VIBE1602"]);
    return;
  }
  expect(checked.result.analysis.diagnostics).toEqual([]);
  expect(checked.emitDiagnostics).toEqual([]);
  writeFileSync(output, checked.result.code);
  for (const zone of ["UTC", "America/Los_Angeles", "Asia/Kathmandu"]) {
    const child = Bun.spawn([process.execPath, "-e", `import { main } from ${JSON.stringify(pathToFileURL(output).href)}; console.log(JSON.stringify(main()))`],
      { env: { ...process.env, TZ: zone }, stdout: "pipe", stderr: "pipe" });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect([zone, exit, stderr]).toEqual([zone, 0, ""]);
    expect(JSON.parse(stdout)).toEqual(vector.output);
  }
});

test("an executable Flow cannot conceal a host-zone setter behind an absolute input", () => {
  const result = compileDurableBody(`import { durable } from "vibelang:flows"
export const Flow = durable((input: number) => {
  const date = new Date(input)
  date.setHours(12)
  return date.getTime()
})`, { fileName: "date-flow.vibe" });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.diagnostics).toMatchObject([{ code: "VIBE1602", file: "date-flow.vibe", line: 4 }]);
});
