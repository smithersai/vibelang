// run-seconds: 300
// VIP-38 native configuration contract, exercised with the pinned rule witness
// promiseInEffectSuccess (EK3897, native TS377108) and floatingEffect (EK3801).
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#7635f76dd5242293
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | `vibelang lint` activates, selects and configures the imported rules exactly as the compiler does for the same project and files; it emits no files, fails on errors, and exits 0 for warnings or suggestions alone.
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#e8d3b2ce5e589c35
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | Native options retain their documented host scope; the compiler’s `*InTscExitCode` options do not apply to it.
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#f036ce7b70c01824
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | The pinned defaults are `diagnostics: true`, `includeSuggestionsInTsc: true`, `ignoreEffectWarningsInTscExitCode: false`, `ignoreEffectErrorsInTscExitCode: false` and `ignoreEffectSuggestionsInTscExitCode: true`.
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#180de866018b562b
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | Before retiring severity-key activation, migration warning `EK3012` identifies a resolved config with an assigned `EK38xx` severity key, `"off"` included, and no resolved `@effect/language-service` plugin entry.
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#141d1970493557ff
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | Controls cover inherited configuration, per-rule `"off"`, native suggestion/error/warning options, the same imported diagnostics under standalone lint, with and without the plugin and the migration above.
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#39c414d762f77a15
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | Compiler diagnostics imported under VIP-38 retain the pinned native Effect TypeScript compiler's exit and `noEmitOnError` policy under the same effective rule, category, inclusion and ignore options; imported warnings affect both by default.
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#4f830a9522879e89
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | The standalone `vibelang lint` command fails only on errors; warnings or suggestions alone exit 0.
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#1a738d2b7ae6d65e
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | A `vibe.severities` entry does not re-enable disabled diagnostics.
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#431d056f8bf0df5d
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | Until the `EK3012` migration below retires the legacy shortcut, an assigned `EK38xx` key in a config without a resolved plugin entry still activates the whole default plugin and reports `EK3012`; after that retirement, such a key alone does not activate the plugin.
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#0b474e927d5b9e4f
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | Conformance uses an actual pinned rule witness, such as `promiseInEffectSuccess` (`EK3897`, native `TS377108`): no plugin and no imported severity entry reports no imported diagnostics; no plugin with an imported severity entry reports the default plugin's diagnostics and `EK3012` before the retirement, and no imported diagnostics after it; an explicit default plugin reports the warning; native disable settings plus a severity override remain disabled.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "VIBELANG_BINARY must name the tested compiler")
const local = fileURLToPath(new URL(".", import.meta.url))
const root = realpathSync(mkdtempSync(join(tmpdir(), "vip38-native-config-")))
// The promiseInEffectSuccess witness alone, and with a floating Effect that
// only the whole default plugin (floatingEffect, default error) reports.
const witness = readFileSync(new URL("./witness.ts.txt", import.meta.url), "utf8")
const floating = witness + "\nEffect.succeed(1)\n"
let checks = 0
try {
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(join(local, "node_modules/effect")), join(root, "node_modules/effect"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  const options = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [], outDir: "out" }
  // Writes the project, locally or through an inherited base, and runs one host.
  const run = ({ plugins, severities, extra = {}, inherited = false, source = witness }, command) => {
    rmSync(join(root, "out"), { recursive: true, force: true })
    writeFileSync(join(root, "main.ts"), source)
    const config = { compilerOptions: { ...options, ...extra, plugins }, vibe: severities ? { severities } : undefined }
    writeFileSync(join(root, "base.json"), JSON.stringify(config))
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify(inherited ? { extends: "./base.json", files: ["main.ts"] } : { ...config, files: ["main.ts"] }))
    const r = spawnSync(binary, [...command, "-p", ".", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30000 })
    assert.ifError(r.error)
    assert.equal(r.signal, null, r.stdout + r.stderr)
    checks++
    const output = r.stdout + r.stderr
    const imported = [...output.matchAll(/^main\.ts\(\d+,\d+\): (\w+) (EK38\d+):/gm)].map(m => m[2] + ":" + m[1]).sort()
    assert.doesNotMatch(output, /\bTS\d+\b|EK(?!38\d|3012\b)\d{4}/, output)
    return { status: r.status, output, imported, migration: /warning EK3012:/.test(output), emitted: existsSync(join(root, "out/main.js")) }
  }
  const both = project => {
    const compiler = run(project, []), lint = run(project, ["lint"])
    const label = JSON.stringify(project) + "\ncompiler:\n" + compiler.output + "\nlint:\n" + lint.output
    // Standalone lint activates, selects and configures exactly as the compiler does, and emits nothing.
    assert.deepEqual(lint.imported, compiler.imported, label)
    assert.equal(lint.migration, compiler.migration, label)
    assert.equal(lint.emitted, false, label)
    // Lint fails only on errors.
    assert.equal(lint.status, compiler.imported.some(d => d.endsWith(":error")) ? 1 : 0, label)
    return { compiler, lint, label }
  }
  const effect = settings => [{ name: "@effect/language-service", ...settings }]

  // Activation matrix, each case written locally and through an inherited base.
  for (const inherited of [false, true]) {
    const matrix = [
      // No plugin and no imported severity entry: no imported diagnostics, no migration.
      [{}, [], false],
      // No plugin with an imported severity entry: the whole default plugin and EK3012.
      [{ severities: { EK3897: "warning" } }, ["EK3801:error", "EK3897:warning"], true],
      // An "off" key still activates the whole default plugin and still needs the migration.
      [{ severities: { EK3897: "off" } }, ["EK3801:error"], true],
      // An unrelated plugin is not the Effect entry.
      [{ plugins: [{ name: "unrelated" }], severities: { EK3897: "warning" } }, ["EK3801:error", "EK3897:warning"], true],
      // An explicit default plugin reports the warning and needs no migration.
      [{ plugins: effect({}) }, ["EK3801:error", "EK3897:warning"], false],
      // Per-rule "off", natively and through vibe.severities.
      [{ plugins: effect({ diagnosticSeverity: { promiseInEffectSuccess: "off" } }) }, ["EK3801:error"], false],
      [{ plugins: effect({}), severities: { EK3897: "off" } }, ["EK3801:error"], false],
      // Native disable settings plus a severity override remain disabled.
      [{ plugins: effect({ diagnostics: false }), severities: { EK3897: "error", EK3801: "error" } }, [], false],
      [{ plugins: effect({ diagnosticSeverity: null }), severities: { EK3897: "error", EK3801: "error" } }, [], false],
    ]
    for (const [project, imported, migration] of matrix) {
      const { compiler, label } = both({ ...project, inherited, source: floating })
      assert.deepEqual(compiler.imported, imported, label)
      assert.equal(compiler.migration, migration, label)
    }
  }

  // Pinned option defaults and the compiler's exit and noEmitOnError policy.
  const pinned = { diagnostics: true, includeSuggestionsInTsc: true, ignoreEffectWarningsInTscExitCode: false, ignoreEffectErrorsInTscExitCode: false, ignoreEffectSuggestionsInTscExitCode: true }
  for (const severity of ["warning", "error", "suggestion"]) {
    for (const noEmitOnError of [false, true]) {
      const project = settings => ({ plugins: effect({ diagnosticSeverity: { promiseInEffectSuccess: severity }, ...settings }), extra: noEmitOnError ? { noEmitOnError } : {} })
      const implicit = both(project({}))
      const explicit = both(project(pinned))
      for (const host of ["compiler", "lint"])
        for (const key of ["status", "imported", "emitted"])
          assert.deepEqual(implicit[host][key], explicit[host][key], host + " " + key + " " + implicit.label + "\n" + explicit.label)
      const { compiler, label } = implicit
      // includeSuggestionsInTsc: true prints the suggestion, and every category is reported.
      assert.deepEqual(compiler.imported, ["EK3897:" + severity], label)
      // Warnings and errors affect exit status and noEmitOnError by default; suggestions do not.
      const fails = severity !== "suggestion"
      assert.equal(compiler.status, fails ? noEmitOnError ? 1 : 2 : 0, label)
      assert.equal(compiler.emitted, !(fails && noEmitOnError), label)
      assert.equal(implicit.lint.status, severity === "error" ? 1 : 0, label)
    }
  }

  // The *InTscExitCode options are compiler options: they change the compiler's
  // status but not standalone lint's, and they never hide a printed diagnostic.
  for (const severity of ["warning", "error", "suggestion"]) {
    const { compiler, lint, label } = both({ plugins: effect({
      diagnosticSeverity: { promiseInEffectSuccess: severity }, ignoreEffectWarningsInTscExitCode: true,
      ignoreEffectErrorsInTscExitCode: true, ignoreEffectSuggestionsInTscExitCode: false }) })
    assert.deepEqual(compiler.imported, ["EK3897:" + severity], label)
    assert.equal(compiler.status, severity === "suggestion" ? 2 : 0, label)
    assert.equal(lint.status, severity === "error" ? 1 : 0, label)
  }
  // A vibe.severities override changes the category, not the pinned options.
  for (const [severity, status] of [["warning", 2], ["error", 2], ["suggestion", 0]]) {
    const { compiler, label } = both({ plugins: effect({}), severities: { EK3897: severity, EK3801: "off" } })
    assert.deepEqual(compiler.imported, ["EK3897:" + severity], label)
    assert.equal(compiler.status, status, label)
  }
} finally { rmSync(root, { recursive: true, force: true }) }
assert.equal(checks, 72)
console.log("VIP-38 native configuration: 72 checks passed")
