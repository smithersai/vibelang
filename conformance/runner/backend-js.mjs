/**
 * The JS reference backend: the TypeScript analysis instrument under
 * `poc/src/language`, reached only through its documented public API.
 *
 *   authored `.sm`
 *     -> `compileComptimeIntrinsics` (compiler-owned comptime evaluation)
 *     -> `compileProject` (real lowering + language diagnostics), under bun
 *     -> `checkEmittedProject` (stock TypeScript check of the emitted set)
 *     -> emitted TypeScript written beside the case's foreign `.ts` modules
 *     -> executed by bun through the shared harness
 *
 * The second step is not optional. `compileAndCheckProject` — the frontend's own
 * one-call acceptance — refuses a program whose emitted TypeScript the stock
 * checker rejects, and so does the `smithers` CLI. A harness that ran only the first
 * step would score such a case green by *omitting a check*, which is exactly the
 * fail-open shape the corpus exists to catch. Emit-check diagnostics are mapped
 * back through the compiler's own source map so a case can name the authored
 * line and column, like every other declared diagnostic.
 *
 * This backend is the oracle the Go fork is measured against, so it is also the
 * one `test/conformance.test.mjs` gates the build on.
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { comptimeTarget, repositoryRoot } from "./corpus.mjs";
import { harnessText } from "./harness.mjs";
import { run } from "./process.mjs";
import { originalPosition } from "./source-map.mjs";

const lowerDriver = join(repositoryRoot, "conformance", "runner", "js-lower.mjs");
const runtimeImport = join(repositoryRoot, "poc", "src", "runtime", "index.ts");
const schemaRuntimeImport = join(repositoryRoot, "poc", "src", "build", "schema-runtime.ts");

/**
 * This backend's compiler-stable Error identity accessor, for the shared
 * harness's failure line.
 *
 * The module is the very specifier the emitted program imports its runtime
 * helpers from (`compile.ts` writes `runtimeImport` into every emitted module),
 * so the harness reads the registry `__vsRegisterError` populated rather than a
 * second, empty instance of it. See `conformance/runner/harness.mjs`.
 */
const identityAccessor = { module: runtimeImport, name: "errorIdentity" };

export const jsBackend = {
  name: "js",
  label: "JS instrument (poc/src/language)",
  /**
   * The work a verdict must actually have done before this backend is entitled
   * to call an expectation satisfied. `conformance/runner/judge.mjs` audits
   * every pass against this, which is what makes "the harness skipped a check"
   * a loud failure instead of a quiet extra pass.
   */
  requiredStages: {
    output: ["lower", "emit-check", "execute"],
    diagnostics: ["lower"],
  },
  emitCheckStage: "emit-check",
  /**
   * The stage a verdict must have gone through before this backend may call a
   * case that ships `assets` satisfied. The Go fork has no counterpart (its
   * bridge has no source-asset pass at all), so only this backend declares one.
   */
  assetStage: "assets",
  async probe() {
    const bun = await run("bun", ["--version"]);
    if (bun.error || bun.status !== 0) return "bun is required to run the JS instrument backend";
    return undefined;
  },
};

/**
 * Compile and, for output cases, execute one case.
 *
 * Returns a backend observation. Every observation carries the `stages` it
 * actually completed, so a verdict can be audited against the work behind it
 * rather than trusted:
 *   { kind: "diagnostics", stage, stages, diagnostics: [{ code, line, column, message }] }
 *   { kind: "output", stages, stdout: string[], exitCode, stderr }
 *   { kind: "error", stages, reason }             — the backend itself broke
 */
export async function runJsCase(testCase, { keepDirectory = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "smithers-conformance-js-"));
  try {
    // Assets are written before lowering, not after. The source-asset compiler
    // reads them from disk beneath the project root, tracks their bytes in its
    // cache identity, and reconciles their file identity against project code —
    // none of which an in-memory stub would exercise. `rootDir` is this
    // directory, so `./config.json` in the authored `.sm` is this file.
    for (const file of testCase.files) {
      if (file.kind !== "asset") continue;
      await mkdir(dirname(join(directory, file.path)), { recursive: true });
      await writeFile(join(directory, file.path), file.text);
    }
    const payload = JSON.stringify({
      rootDir: directory,
      // The cache is part of this case's unique mkdtemp staging tree. It is
      // deleted with that tree, so neither another case nor a later run can
      // observe warm state from this evaluation.
      comptimeCacheDirectory: join(directory, ".smithers-comptime-cache"),
      // One declared target for both backends; see corpus.mjs.
      comptimeTarget,
      runtimeImport,
      schemaRuntimeImport,
      sources: testCase.files
        .filter((file) => file.kind === "smithers")
        .map((file) => ({ fileName: file.path, source: file.text })),
      typeScriptSources: testCase.files
        .filter((file) => file.kind === "typescript")
        .map((file) => ({ fileName: file.path, source: file.text })),
      // Names only: the bytes are already staged above, and the compiler must
      // read them itself. A non-empty list is also what turns the source-asset
      // stage on, so a case that ships no asset takes exactly the pipeline it
      // took before assets existed.
      assets: testCase.files.filter((file) => file.kind === "asset").map((file) => file.path),
      assetCacheDirectory: join(directory, ".smithers-asset-cache"),
      // The one piece of the case's EXPECTATION the driver is told, and it can
      // only make the driver do more work, never less: a run that declares
      // `expect: "output"` is not discarded wholesale by a durable diagnostic,
      // so the report can say the program is wrong rather than say nothing at
      // all. It cannot make a refused program look accepted — the durable
      // diagnostics travel with the response either way. See `js-lower.mjs`.
      expectsOutput: testCase.expectation.expect === "output",
    });
    const lowered = await run("bun", [lowerDriver], { input: payload, cwd: repositoryRoot });
    if (lowered.error) {
      return { kind: "error", stages: [], reason: `could not run bun: ${lowered.error.message}` };
    }
    let response;
    try {
      response = JSON.parse(lowered.stdout);
    } catch {
      return {
        kind: "error",
        stages: [],
        reason: `the lowering driver did not return JSON (exit ${lowered.status}): ${lowered.stderr.slice(0, 400)}`,
      };
    }
    if (!response.ok) return { kind: "error", stages: [], reason: `frontend lowering failed: ${response.error}` };

    // The source-asset pass is one of the frontend's ordered stages, like
    // comptime and durable lowering, so its diagnostics are reported as part of
    // `lower`. It gets its own stage marker as well, purely so `auditVerdict`
    // can refuse to call a case that ships assets satisfied unless the compiler
    // really read them: a green asset case that never opened the file would be
    // the same fail-open shape the emit-check audit exists to catch.
    const staged = response.assetsCompiled === true ? ["lower", "assets"] : ["lower"];

    const errors = response.diagnostics.filter((item) => item.severity === "error");
    if (errors.length > 0) {
      return {
        kind: "diagnostics",
        stage: "language",
        stages: staged,
        diagnostics: errors.map((item) => ({
          code: item.code,
          file: item.fileName,
          line: item.line,
          column: item.column,
          message: item.message,
          mapped: item.mapped ?? true,
        })),
      };
    }

    if (response.emitChecked !== true) {
      return {
        kind: "error",
        stages: staged,
        reason: "the lowering driver did not run the emitted-TypeScript check for an accepted program",
      };
    }
    if (response.emitDiagnostics.length > 0) {
      return {
        kind: "diagnostics",
        stage: "emit",
        stages: [...staged, "emit-check"],
        diagnostics: response.emitDiagnostics.map((item) => authoredPosition(item, response.files, testCase)),
      };
    }

    for (const file of testCase.files) {
      if (file.kind === "typescript") await writeFile(join(directory, file.path), file.text);
    }
    // The compiler-issued module for each asset, at the exact output path the
    // emitted `.sm` was rewritten to import.
    for (const generated of response.generatedFiles ?? []) {
      await mkdir(dirname(generated.fileName), { recursive: true });
      await writeFile(generated.fileName, generated.code);
    }
    for (const [fileName, compiled] of Object.entries(response.files)) {
      await writeFile(join(directory, fileName.replace(/\.sm$/, ".ts")), compiled.code);
    }
    const entryModule = `./${testCase.entry.replace(/\.sm$/, ".ts")}`;
    await writeFile(join(directory, "conformance-harness.ts"), harnessText(entryModule, identityAccessor));

    const executed = await run("bun", [join(directory, "conformance-harness.ts")], { cwd: directory });
    if (executed.error) {
      return {
        kind: "error",
        stages: [...staged, "emit-check"],
        reason: `could not execute with bun: ${executed.error.message}`,
      };
    }
    return {
      kind: "output",
      stages: [...staged, "emit-check", "execute"],
      stdout: splitLines(executed.stdout),
      stderr: executed.stderr,
      exitCode: executed.status,
      directory: keepDirectory ? directory : undefined,
    };
  } finally {
    if (!keepDirectory) await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Move one emitted-TypeScript diagnostic onto authored coordinates.
 *
 * Three shapes, and none of them silently invents a position:
 *   - the diagnostic is inside a case's own foreign `.ts` module: that file is
 *     passed through verbatim, so its position already is the authored one;
 *   - the diagnostic is inside an emitted `.sm` module and the compiler's source
 *     map anchors it: report the authored `.sm` line and column;
 *   - anything else (an unmapped generated line, a diagnostic in the runtime, a
 *     file-less diagnostic): keep the generated position and say so with
 *     `mapped: false`, so a reviewer can see the harness did not resolve it.
 */
function authoredPosition(item, compiledFiles, testCase) {
  const base = { code: `TS${item.code}`, message: item.message, mapped: false };
  if (item.fileName === undefined || item.line === undefined) {
    return { ...base, file: item.fileName, line: 0, column: 0 };
  }
  const absolute = resolve(item.fileName);
  const foreign = testCase.files.find(
    (file) => file.kind === "typescript" && resolve(item.fileName).endsWith(`/${file.path}`),
  );
  if (foreign) return { ...base, file: foreign.path, line: item.line, column: item.column, mapped: true };

  const owner = Object.entries(compiledFiles).find(([, file]) => resolve(file.outputFileName) === absolute);
  if (!owner) return { ...base, file: item.fileName, line: item.line, column: item.column };
  const [authoredName, file] = owner;
  if (!file.sourceMap) return { ...base, file: authoredName, line: item.line, column: item.column };
  const mapped = originalPosition(file.sourceMap, item.line - 1, item.column - 1);
  if (!mapped) return { ...base, file: authoredName, line: item.line, column: item.column };
  return {
    ...base,
    file: mapped.source,
    line: mapped.line + 1,
    column: mapped.column + 1,
    mapped: true,
  };
}

/**
 * Split captured stdout into the lines the program printed.
 *
 * Exactly one trailing newline is removed — the one `console.log` adds to the
 * last line — and no more. Stripping *every* trailing newline made an empty
 * final line indistinguishable from a missing one, so a program that printed
 * `["a", ""]` and a program that printed `["a"]` produced the same observation.
 * That is a fail-open in the observation apparatus itself: the Go fork's
 * divergence on `switch-case-final-expression-is-the-value` prints an empty
 * last line, and the old rule reported it as a line that never happened.
 */
export function splitLines(text) {
  if (text.length === 0) return [];
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed.split("\n");
}

/** Compile and execute one plain-TypeScript interop file through the JS backend. */
export async function runJsInterop(interopCase) {
  const directory = await mkdtemp(join(tmpdir(), "smithers-conformance-js-interop-"));
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, interopCase.entry), interopCase.text);
    const executed = await run("bun", [join(directory, interopCase.entry)], { cwd: directory });
    if (executed.error) {
      return { kind: "error", stages: [], reason: `could not execute with bun: ${executed.error.message}` };
    }
    return {
      kind: "output",
      stages: ["execute"],
      stdout: splitLines(executed.stdout),
      stderr: executed.stderr,
      exitCode: executed.status,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
