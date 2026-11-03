import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"

const root = process.env.SPEC_CONFIG_ROOT ?? fileURLToPath(new URL("../../", import.meta.url))
const read = path => readFileSync(resolve(root, path), "utf8")
const chapter = read("docs/design/src/007-tooling.md")
const appendix = read("docs/design/src/900-appendices.md")
const section = name => {
  const start = chapter.indexOf(`### ${name}\n`)
  assert.notEqual(start, -1, `missing ${name}`)
  return chapter.slice(start).split(/\n#{1,3} /)[0]
}

// VIP-30/34/38: the compact tables must retain both admission errors and all
// transition categories. Mutation checks catch accidental code/category drift.
const categories = text => new Map([...text.matchAll(/^\| `(EK\d+)` \| (Error|Warning) \|/gm)]
  .map(([, code, category]) => [code, category.toLowerCase()]))
const appendixCategory = code => {
  const row = appendix.split("\n").find(line => line.startsWith(`| \`${code}\` |`))
  assert.ok(row, `${code} has no Appendix B row`)
  return /\| (?:lint )?warning[: (]/.test(row) ? "warning" : "error"
}
const agrees = text => [...categories(text)].every(([code, category]) => category === appendixCategory(code))

test("configuration and transition tables agree with Appendix B", () => {
  const text = section("Diagnostic settings") + section("Transitional diagnostics")
  assert.deepEqual([...categories(text).keys()], ["EK3006", "EK3007", "EK4853", "EK4854", "EK4855", "EK4856", "EK4857"])
  assert.ok(agrees(text))
  fc.assert(fc.property(fc.constantFrom(...categories(text).keys()), code => {
    const category = appendixCategory(code) === "error" ? "Error" : "Warning"
    const other = category === "Error" ? "Warning" : "Error"
    assert.equal(agrees(text.replace(`| \`${code}\` | ${category} |`, `| \`${code}\` | ${other} |`)), false)
  }), { seed: 73034, numRuns: 100 })
})

test("lint host rules distinguish reporting, exit status and activation", () => {
  const reporting = section("Reporting and exit status")
  for (const option of ["includeSuggestionsInTsc", "ignoreEffectWarningsInTscExitCode", "ignoreEffectErrorsInTscExitCode", "ignoreEffectSuggestionsInTscExitCode"]) {
    assert.ok(reporting.includes(`\`${option}\``), option)
  }
  assert.match(reporting, /Ignore options do not hide printed diagnostics/)
  assert.match(reporting, /exits `0` for warnings or suggestions alone/)
  assert.match(chapter, /entry alone neither activates the plugin nor re-enables disabled diagnostics/)
  assert.match(chapter, /Once enabled, severity resolves from `vibe.severities`, then the repository's Effect language-service configuration, then the rule's default/)
})

test("plugin migration retains all scopes, ownership and preserving defaults", () => {
  const migration = section("Severity-key activation migration")
  for (const text of ["`EK3012`", '`"off"` included', "`--fix-migration-only`", "`--fix-vip-only`",
    "Copy inherited plugin entries", "writes no configs", "whole default plugin", "Add no per-rule suppression or ignore flags",
    "diagnostic inclusion, categories, exit status and emission", "idempotent"]) assert.ok(migration.includes(text), text)
  const entry = section("Legacy entry-dispatch migration")
  for (const text of ["A marker does not by itself add a layer", "entry-only execution and import-only behavior", "with a nonzero exit", "No retired dispatcher or fallback runner"]) assert.ok(entry.includes(text), text)
  const ownership = section("Fix ownership and preservation")
  for (const text of ["an owned source an import reaches", "never overwrites an existing file", "`typeRoots`", "`tsBuildInfoFile`", "With `-b`", "not-fixed explanation"]) assert.ok(ownership.includes(text), text)
})

// VIP-6 and VIP-14 supply independent preludes. Turning off bare function
// globals does not require an import for a still-implicit module namespace.
test("prelude settings preserve independent function and module switches", () => {
  const row = chapter.split("\n").find(line => line.startsWith("| `vibe.effectGlobals` |"))
  assert.doesNotMatch(row, /requires imports/)
  assert.match(row, /`false` turns the function globals off/)
  assert.match(row, /`Effect.sleep` remain available when `vibe.effectModules` is `true`/)
  assert.match(chapter, /With both prelude switches `false`, write explicit imports/)
})

// VIP-38 and Appendix B require the resolved named Effect entry. A different
// TypeScript plugin must not suppress EK3012 or its preserving config repair.
test("only the named Effect plugin prevents severity-key migration", () => {
  const migration = section("Severity-key activation migration")
  const exemption = migration.split(". ").find(sentence => sentence.includes("prevents this migration"))
  const name = text => text?.match(/existing resolved plugin entry named `([^`]+)`/)?.[1]
  assert.equal(name(exemption), "@effect/language-service")
  assert.match(exemption, /including a native disable setting/)
  assert.match(migration, /An unrelated plugin does not prevent it/)
  fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 40 }).filter(value => !value.includes("`") && value !== "@effect/language-service"), other => {
    assert.notEqual(name(exemption.replace("@effect/language-service", other)), "@effect/language-service")
  }), { seed: 32007, numRuns: 100 })
})
