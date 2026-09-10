// Standalone review probes. Reports observations; does not update conformance
// expectations or assert that the observed behavior is correct.
// From the repository root:
//   bun reviews/2026-09-05/probe.ts [case-name ...]
//   bun reviews/2026-09-05/probe.ts --go [case-name ...]
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compileAndCheckVibeLang } from "../../poc/src/language/validate.ts";
import { compileDurableBody } from "../../poc/src/durable/body-compiler.ts";
import { loadDurableBody } from "../../poc/src/durable/body-artifact.ts";
import { compileComptimeIntrinsics } from "../../poc/src/build/comptime-intrinsic.ts";
import { ComptimeCompiler } from "../../poc/src/build/comptime.ts";

type Case = { name: string; stage: "language" | "comptime" | "body"; source: string };
const args = process.argv.slice(2);
const go = args.includes("--go");
const names = args.filter(arg => arg !== "--go");
const cases = (JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8")) as Case[])
  .filter(test => names.length === 0 || names.includes(test.name));
if (names.some(name => !cases.some(test => test.name === name))) throw new Error("Unknown case name");
const report = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");

if (go) {
  const { prepareGoBackend, runGoCase } = await import("../../conformance/runner/backend-go.mjs");
  const context = await prepareGoBackend();
  if (context.unavailable) throw new Error(context.unavailable);
  try {
    for (const test of cases) {
      if (test.stage === "body") {
        report({ name: test.name, skipped: "Direct executable-body API uses the native SDK profile, not standalone Plan emission" });
        continue;
      }
      // The corpus execution harness accepts string[] observations. Preserve
      // each scalar-returning probe's body and add only an observation adapter.
      let source = test.source;
      const scalar = new Set(["async_discard", "method_discard", "callback_discard", "row_assign",
        "date_parse", "date_constructor", "date_setter", "finally_return", "finally_throw", "async_finally_throw"]);
      if (scalar.has(test.name)) {
        const async = /export\s+async\s+function\s+main/.test(source);
        source = source.replace(/export\s+(async\s+)?function\s+main/, (_, prefix) => `${prefix ?? ""}function reviewed`);
        source += `\nexport ${async ? "async " : ""}function main(): ${async ? "Promise<string[]>" : "string[]"} { return [String(${async ? "await " : ""}reviewed())] }`;
      }
      report({ name: test.name, result: await runGoCase(context, {
        id: test.name, entry: "main.vibe",
        files: [{ path: "main.vibe", kind: "vibelang", text: source }],
        expectation: { expect: "output" },
      }) });
    }
  } finally { await context.dispose(); }
} else {
  const temporary = mkdtempSync(join(tmpdir(), "vibelang-review-probes-"));
  const runtimeImport = fileURLToPath(new URL("../../poc/src/runtime/index.ts", import.meta.url));
  for (const test of cases) {
    try {
      let source = test.source;
      if (test.stage === "body") {
        const result = compileDurableBody(source, { fileName: test.name + ".vibe" });
        if (!result.ok) { report({ name: test.name, diagnostics: result.diagnostics }); continue; }
        const attempt = loadDurableBody(result.body).create(0);
        report({ name: test.name, diagnostics: [], actions: result.body.manifest.actions,
          step: await attempt.computation.next() });
        continue;
      }
      if (test.stage === "comptime") {
        const fileName = test.name + ".vibe";
        const result = await compileComptimeIntrinsics({
          compiler: new ComptimeCompiler({ root: temporary, cacheDirectory: join(temporary, test.name + "-cache"), target: "node-es2022" }),
          sources: { [fileName]: source },
        });
        if (!result.ok) { report({ name: test.name, diagnostics: result.diagnostics }); continue; }
        source = result.loweredSources![fileName]!;
      }
      const outputFileName = join(temporary, test.name + ".ts");
      const checked = compileAndCheckVibeLang(source, {
        fileName: join(temporary, test.name + ".vibe"), outputFileName, runtimeImport, sourceMap: false,
      });
      const diagnostics = [...checked.result.analysis.diagnostics, ...checked.emitDiagnostics.map(issue => ({
        code: issue.code, message: issue.message,
      }))];
      report({ name: test.name, diagnostics, rows: checked.result.analysis.rows });
      if (diagnostics.length) continue;
      writeFileSync(outputFileName, checked.result.code);
      const module = await import(pathToFileURL(outputFileName).href);
      try { report({ name: test.name, value: await module.main() }); }
      catch (error) { report({ name: test.name, runtimeError: String(error) }); }
    } catch (error) { report({ name: test.name, compilerOrBodyError: String(error) }); }
  }
  process.stderr.write(`Generated probe outputs: ${temporary}\n`);
}
