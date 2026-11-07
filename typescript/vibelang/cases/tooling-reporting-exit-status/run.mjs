// run-seconds: 300
// rule-evidence: docs/design/src/007-tooling.md#reporting-and-exit-status | | Compiler | Warnings affect exit status and `noEmitOnError` unless `ignoreEffectWarningsInTscExitCode` is `true`; errors use `ignoreEffectErrorsInTscExitCode`.
// rule-evidence: docs/design/src/007-tooling.md#reporting-and-exit-status | Suggestions print when `includeSuggestionsInTsc` is `true` and affect exit/emission only when `ignoreEffectSuggestionsInTscExitCode` is `false`.
// rule-evidence: docs/design/src/007-tooling.md#reporting-and-exit-status | | `vibelang lint` | Emits no files, fails on errors, and exits `0` for warnings or suggestions alone.
// rule-evidence: docs/design/src/007-tooling.md#reporting-and-exit-status | Compiler `*InTscExitCode` options do not apply.
// rule-evidence: docs/design/src/007-tooling.md#reporting-and-exit-status | Pinned defaults are `diagnostics: true`, `includeSuggestionsInTsc: true`, `ignoreEffectErrorsInTscExitCode: false`, `ignoreEffectWarningsInTscExitCode: false` and `ignoreEffectSuggestionsInTscExitCode: true`.
// Drives the tested compiler over one imported error (floatingEffect,
// EK3801), one warning (effectInFailure, EK3829) and one suggestion
// (effectSucceedWithVoid, EK3834), each alone, under the compiler and under
// `vibelang lint`, and checks printed diagnostics, exit status and emitted
// files for every option the table names.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "VIBELANG_BINARY must name the tested compiler")
const local = fileURLToPath(new URL(".", import.meta.url))
const root = realpathSync(mkdtempSync(join(tmpdir(), "reporting-exit-status-")))
const sources = {
  error: 'import { Effect } from "effect"\nEffect.succeed(1)\nexport {}\n',
  warning: 'import { Effect } from "effect"\nexport const w = Effect.fail(Effect.succeed(1))\n',
  suggestion: 'import { Effect } from "effect"\nexport const s = Effect.succeed(void 0)\n'
}
const codes = { error: "error EK3801", warning: "warning EK3829", suggestion: "suggestion EK3834" }
const base = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [], outDir: "out" }
let checks = 0
try {
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(join(local, "node_modules/effect")), join(root, "node_modules/effect"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  const invoke = (kind, plugin, { lint = false, noEmitOnError = false } = {}) => {
    rmSync(join(root, "out"), { recursive: true, force: true })
    writeFileSync(join(root, "main.ts"), sources[kind])
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { ...base, ...(noEmitOnError ? { noEmitOnError } : {}),
      plugins: [{ name: "@effect/language-service", ...plugin }] }, files: ["main.ts"] }))
    const r = spawnSync(binary, [...(lint ? ["lint"] : []), "-p", ".", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30000 })
    assert.ifError(r.error)
    assert.equal(r.signal, null, r.stdout + r.stderr)
    checks++
    const output = r.stdout + r.stderr
    assert.doesNotMatch(output, /\bTS\d+|EK(?!3801|3829|3834)\d+/, output)
    return { status: r.status, output, printed: output.includes(codes[kind]), emitted: existsSync(join(root, "out/main.js")), out: existsSync(join(root, "out")) }
  }
  const expect = (r, status, printed, emitted, label) => {
    assert.equal(r.status, status, label + "\n" + r.output)
    assert.equal(r.printed, printed, label + "\n" + r.output)
    if (emitted !== undefined) assert.equal(r.emitted, emitted, label + "\n" + r.output)
  }

  // Pinned defaults: a bare entry prints all three categories (diagnostics,
  // includeSuggestionsInTsc), errors and warnings fail the build and block
  // noEmitOnError, suggestions do not (ignoreEffectSuggestionsInTscExitCode).
  for (const noEmitOnError of [false, true]) {
    const failed = noEmitOnError ? 1 : 2
    expect(invoke("error", {}, { noEmitOnError }), failed, true, !noEmitOnError, "default error")
    expect(invoke("warning", {}, { noEmitOnError }), failed, true, !noEmitOnError, "default warning")
    expect(invoke("suggestion", {}, { noEmitOnError }), 0, true, true, "default suggestion")
    // The explicit pinned values behave exactly like the defaults.
    const pinned = { diagnostics: true, includeSuggestionsInTsc: true, ignoreEffectErrorsInTscExitCode: false,
      ignoreEffectWarningsInTscExitCode: false, ignoreEffectSuggestionsInTscExitCode: true }
    for (const kind of ["error", "warning", "suggestion"]) {
      const d = invoke(kind, {}, { noEmitOnError }), p = invoke(kind, pinned, { noEmitOnError })
      assert.deepEqual([p.status, p.printed, p.emitted], [d.status, d.printed, d.emitted], kind + "\n" + p.output)
    }
    // diagnostics: false is the non-default: nothing imported prints or fails.
    for (const kind of ["error", "warning", "suggestion"]) expect(invoke(kind, { diagnostics: false }, { noEmitOnError }), 0, false, true, "diagnostics false " + kind)
  }

  // Compiler: warnings fail unless ignoreEffectWarningsInTscExitCode; errors
  // follow ignoreEffectErrorsInTscExitCode; each option covers only its own
  // category, and ignoring never hides the printed diagnostic.
  for (const noEmitOnError of [false, true]) {
    const failed = noEmitOnError ? 1 : 2
    expect(invoke("warning", { ignoreEffectWarningsInTscExitCode: true }, { noEmitOnError }), 0, true, true, "ignored warning")
    expect(invoke("warning", { ignoreEffectErrorsInTscExitCode: true }, { noEmitOnError }), failed, true, !noEmitOnError, "warning under error ignore")
    expect(invoke("error", { ignoreEffectErrorsInTscExitCode: true }, { noEmitOnError }), 0, true, true, "ignored error")
    expect(invoke("error", { ignoreEffectWarningsInTscExitCode: true }, { noEmitOnError }), failed, true, !noEmitOnError, "error under warning ignore")
  }

  // Suggestions print only with includeSuggestionsInTsc and affect exit and
  // emission only when ignoreEffectSuggestionsInTscExitCode is false.
  for (const noEmitOnError of [false, true]) {
    const failed = noEmitOnError ? 1 : 2
    expect(invoke("suggestion", { includeSuggestionsInTsc: false }, { noEmitOnError }), 0, false, true, "hidden suggestion")
    expect(invoke("suggestion", { includeSuggestionsInTsc: true, ignoreEffectSuggestionsInTscExitCode: true }, { noEmitOnError }), 0, true, true, "printed ignored suggestion")
    expect(invoke("suggestion", { includeSuggestionsInTsc: true, ignoreEffectSuggestionsInTscExitCode: false }, { noEmitOnError }), failed, true, !noEmitOnError, "failing suggestion")
  }

  // vibelang lint: no files, errors fail, warnings or suggestions alone exit 0,
  // and the compiler's *InTscExitCode options change none of that.
  const lintOptions = [{}, { ignoreEffectErrorsInTscExitCode: true }, { ignoreEffectWarningsInTscExitCode: false },
    { ignoreEffectSuggestionsInTscExitCode: false },
    { ignoreEffectErrorsInTscExitCode: true, ignoreEffectWarningsInTscExitCode: true, ignoreEffectSuggestionsInTscExitCode: true },
    { ignoreEffectErrorsInTscExitCode: false, ignoreEffectWarningsInTscExitCode: false, ignoreEffectSuggestionsInTscExitCode: false }]
  for (const plugin of lintOptions) {
    for (const noEmitOnError of [false, true]) {
      const label = "lint " + JSON.stringify(plugin)
      for (const [kind, status] of [["error", 1], ["warning", 0], ["suggestion", 0]]) {
        const r = invoke(kind, plugin, { lint: true, noEmitOnError })
        expect(r, status, true, false, label + " " + kind)
        assert.equal(r.out, false, label + " wrote out/")
      }
    }
  }
} finally { rmSync(root, { recursive: true, force: true }) }
assert.equal(checks, 74)
console.log("reporting and exit status: 74 checks passed")
