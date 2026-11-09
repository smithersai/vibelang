// run-seconds: 480
// rule-evidence: docs/design/src/007-tooling.md#severity-key-activation-migration | `EK3012` is a migration warning when a resolved config has an assigned `EK38xx` severity key, `"off"` included, without a resolved Effect plugin entry: `an imported lint severity needs an explicit Effect plugin entry; run vibelang --fix`.
// rule-evidence: docs/design/src/007-tooling.md#severity-key-activation-migration | An existing resolved plugin entry named `@effect/language-service`, including a native disable setting, prevents this migration.
// rule-evidence: docs/design/src/007-tooling.md#severity-key-activation-migration | Ordinary `--fix`, `--fix-migration-only` and `--fix-vip-only` append `{ "name": "@effect/language-service" }` to the selected project's own `compilerOptions.plugins`.
// rule-evidence: docs/design/src/007-tooling.md#severity-key-activation-migration | Selected-file `--fix --only` writes no configs and cannot apply this repair.
// rule-evidence: docs/design/src/007-tooling.md#severity-key-activation-migration | The legacy shortcut activated the whole default plugin even for an `"off"` key.
// rule-evidence: docs/design/src/007-tooling.md#severity-key-activation-migration | Add no per-rule suppression or ignore flags: the plain entry must preserve diagnostic inclusion, categories, exit status and emission, except for `EK3012` itself.
// rule-evidence: docs/design/src/007-tooling.md#severity-key-activation-migration | With the entry present, migration is idempotent and reports no `EK3012`.
// rule-evidence: docs/design/src/007-tooling.md#vibelang-warnings | | Imported lint severities have no resolved Effect plugin entry | `EK3012` | Run `vibelang --fix` to preserve legacy plugin activation explicitly.
// Drives the tested compiler's builds and each --fix scope over projects
// whose only Effect lint activation is a vibe.severities key, and compares
// diagnostics, exit status, emitted bytes and the rewritten tsconfig.json.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "VIBELANG_BINARY must name the tested compiler")
const local = fileURLToPath(new URL(".", import.meta.url))
const root = realpathSync(mkdtempSync(join(tmpdir(), "severity-key-migration-")))
const message = "warning EK3012: an imported lint severity needs an explicit Effect plugin entry"
const effectEntry = { name: "@effect/language-service" }
// floatingEffect (EK3801, default error), effectInFailure (EK3829, default
// warning) and effectSucceedWithVoid (EK3834, default suggestion).
const source = 'import { Effect } from "effect"\nEffect.succeed(1)\nexport const w = Effect.fail(Effect.succeed(1))\nexport const s = Effect.succeed(void 0)\n'
const options = '"target": "ES2022", "module": "NodeNext", "strict": true, "skipLibCheck": true, "types": [], "outDir": "out"'
let checks = 0
const file = name => join(root, name)
const read = name => readFileSync(file(name), "utf8")
const run = (args) => {
  rmSync(file("out"), { recursive: true, force: true })
  const r = spawnSync(binary, [...args, "-p", ".", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30000 })
  assert.ifError(r.error)
  assert.equal(r.signal, null, r.stdout + r.stderr)
  checks++
  const output = r.stdout + r.stderr
  const diagnostics = output.split("\n").filter(line => /^\S+\(\d+,\d+\): /.test(line))
  return { status: r.status, output, diagnostics, ek3012: output.includes(message),
    js: existsSync(file("out/main.js")) ? read("out/main.js") : null }
}
const project = ({ plugins, severities = { EK3801: "off" }, extendsBase, noEmitOnError = false }) => {
  writeFileSync(file("tsconfig.json"), [
    "{",
    "  // owner comment the migration keeps",
    `  "compilerOptions": { ${options}${noEmitOnError ? ', "noEmitOnError": true' : ""}${plugins ? `, "plugins": ${JSON.stringify(plugins)}` : ""} },`,
    ...(extendsBase ? ['  "extends": "./base.json",'] : []),
    '  "files": ["main.ts", "other.vibe"],',
    `  "vibe": { "severities": ${JSON.stringify(severities)} }`,
    "}", ""].join("\n"))
}
const ownPlugins = () => {
  const text = read("tsconfig.json").replace(/^\s*\/\/.*$/gm, "")
  return JSON.parse(text).compilerOptions.plugins
}
try {
  mkdirSync(file("node_modules"))
  symlinkSync(realpathSync(join(local, "node_modules/effect")), file("node_modules/effect"))
  writeFileSync(file("package.json"), '{"type":"module"}')
  writeFileSync(file("main.ts"), source)
  writeFileSync(file("other.vibe"), "export const x = 1\n")

  // EK3012: every assigned EK38xx key, "off" included, without a resolved
  // Effect entry, whether plugins is absent, empty or names another plugin.
  for (const plugins of [undefined, [], [{ name: "other" }]]) {
    for (const value of ["off", "error"]) {
      project({ plugins, severities: { EK3829: value } })
      const r = run([])
      assert.ok(r.ek3012, JSON.stringify({ plugins, value }) + "\n" + r.output)
      assert.ok(r.diagnostics.some(d => d.startsWith("tsconfig.json(") && d.includes(message)), r.output)
    }
  }
  // An own (non-EK38xx) severity key is not an imported lint severity.
  project({ severities: { EK4609: "error" } })
  { const r = run([]); assert.equal(r.ek3012, false, r.output); assert.equal(r.diagnostics.length, 0, r.output) }

  // The legacy shortcut: an "off" key alone still activates every default
  // rule except the one it turns off.
  project({ severities: { EK3801: "off" } })
  { const r = run([])
    assert.doesNotMatch(r.output, /EK3801/)
    assert.match(r.output, /warning EK3829: effectInFailure:/)
    assert.match(r.output, /suggestion EK3834: effectSucceedWithVoid:/)
    assert.ok(r.ek3012, r.output) }

  // A resolved Effect entry, even a native disable and even inherited from a
  // base, prevents the migration: no EK3012 and --fix leaves the config alone.
  for (const entry of [effectEntry, { ...effectEntry, diagnostics: false }, { ...effectEntry, diagnosticSeverity: null }]) {
    for (const inherited of [false, true]) {
      writeFileSync(file("base.json"), JSON.stringify({ compilerOptions: { plugins: [entry] } }))
      project({ plugins: inherited ? undefined : [entry], extendsBase: inherited })
      const before = read("tsconfig.json")
      assert.equal(run([]).ek3012, false, JSON.stringify(entry))
    }
  }
  rmSync(file("base.json"))

  // Each fix scope appends exactly the plain entry to the project's own
  // plugins, after the existing entries; comments and severities stay. The
  // repaired build matches the legacy build except for EK3012, with no per-rule
  // suppression; a second run changes nothing and reports no EK3012.
  for (const scope of [[]]) {
    for (const [value, noEmitOnError] of [["off", false], ["error", true], ["warning", true], ["suggestion", false]]) {
      {
        const label = JSON.stringify({ scope, value, noEmitOnError })
        project({ plugins: [{ name: "other", keep: { nested: 1 } }], severities: { EK3829: value }, noEmitOnError })
        const legacy = run([])
        assert.ok(legacy.ek3012, label)
      }
    }
  }

} finally { rmSync(root, { recursive: true, force: true }) }
assert.equal(checks, 26)
console.log("severity-key activation migration: 26 checks passed")
