import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { applyImportStyle, importStylePolicy } from "../lib/import-style.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const compiler = fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const parse = (text, file = "src/job.vibe") => {
  const child = spawnSync(compiler, ["--estree", file], { input: text, encoding: "utf8" })
  assert.equal(child.status, 0, child.stderr)
  const { ast, error } = JSON.parse(child.stdout)
  if (error) throw new Error(error.message)
  return ast
}
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-job-array-alias.json", import.meta.url), "utf8"))
const styles = {
  allowed: { aliases: false, stars: false },
  aliases: { aliases: true, stars: false },
  both: { aliases: true, stars: true },
}
const rewrite = (text, policy) => applyImportStyle(text, parse(text), policy)

function repository(files) {
  const root = mkdtempSync(join(tmpdir(), "import-style-"))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  return { root, tracked: Object.keys(files), done: () => rmSync(root, { recursive: true, force: true }) }
}

test("policy reads the repository's ast-grep and lint rules for the three styles", () => {
  const cases = [
    [{ "package.json": "{}" }, styles.allowed],
    [{ "script/ast-grep/sgconfig.yml": "ruleDirs:\n  - rules\n", "script/ast-grep/rules/no-import-alias.yml": corpus.rules.alias }, styles.aliases],
    [{ "script/ast-grep/sgconfig.yml": "ruleDirs:\n  - rules\n", "script/ast-grep/rules/no-import-alias.yml": corpus.rules.alias, "script/ast-grep/rules/no-star-import.yml": corpus.rules.star }, styles.both],
    [{ "sgconfig.yml": "ruleDirs: [rules]\n", "rules/a.yml": corpus.rules.alias, ".oxlintrc.json": '{"rules":{"import/no-namespace":"error"}}' }, styles.both],
    // A rule outside every sgconfig root, or switched off, forbids nothing.
    [{ "rules/no-import-alias.yml": corpus.rules.alias }, styles.allowed],
    [{ "sgconfig.yml": "ruleDirs: [rules]\n", "rules/a.yml": corpus.rules.alias.replace("severity: error", "severity: off"), ".oxlintrc.json": '{"rules":{"import/no-namespace":"off"}}' }, styles.allowed],
  ]
  for (const [files, want] of cases) {
    const repo = repository(files)
    try {
      const { aliases, stars } = importStylePolicy(repo.root, repo.tracked)
      assert.deepEqual({ aliases, stars }, want, JSON.stringify(Object.keys(files)))
    } finally {
      repo.done()
    }
  }
})

test("aliases allowed: the fix's Array as Arr stays", () => {
  const result = rewrite(corpus.fixed, styles.allowed)
  assert.equal(result.text, null)
  assert.deepEqual(result.rewritten, [])
})

test("aliases forbidden: a namespace import of the module, uses unchanged", () => {
  const result = rewrite(corpus.fixed, styles.aliases)
  assert.equal(result.text, corpus.expected.aliases)
  assert.deepEqual(result.rewritten, [{ local: "Arr", module: "effect/Array", form: "namespace" }])
  parse(result.text)
})

test("aliases and stars forbidden: the used members by name from the module", () => {
  const result = rewrite(corpus.fixed, styles.both)
  assert.equal(result.text, corpus.expected.both)
  assert.deepEqual(result.refused, [])
  assert.doesNotMatch(result.text, /\bArr\b/)
  parse(result.text)
})

test("a member name the file already binds or reads refuses, leaving the alias", () => {
  for (const clash of ["const filterMap = (xs: number[]) => xs\n", "export const n = filterMap\n", "function g(filterMap: number) { return filterMap }\n"]) {
    const text = corpus.fixed + clash
    const result = rewrite(text, styles.both)
    assert.equal(result.text, null, clash)
    assert.match(result.refused[0].reason, /already binds or reads filterMap/)
  }
  // A property named like the member is no binding.
  const property = corpus.fixed + "export const o = { filterMap: 1 }.filterMap\n"
  assert.match(rewrite(property, styles.both).text, /^import \{ filterMap, isArray \} from "effect\/Array"$/m)
})

test("a use other than Arr.member refuses the named form only", () => {
  const text = corpus.fixed + "export const modules = { Array: Arr }\n"
  const both = rewrite(text, styles.both)
  assert.equal(both.text, null)
  assert.match(both.refused[0].reason, /used other than as Arr.member/)
  assert.match(rewrite(text, styles.aliases).text, /^import \* as Arr from "effect\/Array"$/m)
})

test("other specifiers of the effect import stay in place", () => {
  const text = 'import { Array as Arr, Result, type Option } from "effect"\nexport const f = (xs: number[], o: Option.Option<number>) => Arr.take(xs, 1)\n'
  assert.equal(rewrite(text, styles.both).text,
    'import { Result, type Option } from "effect"\nimport { take } from "effect/Array"\nexport const f = (xs: number[], o: Option.Option<number>) => take(xs, 1)\n')
  assert.equal(rewrite(text, styles.aliases).text,
    'import { Result, type Option } from "effect"\nimport * as Arr from "effect/Array"\nexport const f = (xs: number[], o: Option.Option<number>) => Arr.take(xs, 1)\n')
})

// Property: for any set of used members, with or without one already bound,
// each style writes exactly what its rule accepts and the result parses.
test("property: every style writes an import its rules accept", () => {
  const pool = ["filterMap", "take", "map", "head", "isArray", "append", "reverse"]
  fc.assert(fc.property(fc.uniqueArray(fc.constantFrom(...pool), { minLength: 1, maxLength: 5 }), fc.option(fc.constantFrom(...pool), { nil: null }), fc.constantFrom("allowed", "aliases", "both"),
    (members, clash, style) => {
      const body = members.map((m, i) => `export const v${i} = Arr.${m}`).join("\n")
      const text = 'import { Array as Arr, Result } from "effect"\n' + body + "\n" + (clash ? `const ${clash} = 0\nexport const c = ${clash}\n` : "")
      const result = rewrite(text, styles[style])
      if (style === "allowed") {
        assert.equal(result.text, null)
      } else if (style === "aliases") {
        assert.match(result.text, /^import \* as Arr from "effect\/Array"$/m)
        assert.doesNotMatch(result.text, /Array as Arr/)
        parse(result.text)
      } else if (clash && members.includes(clash)) {
        assert.equal(result.text, null)
        assert.equal(result.refused.length, 1)
      } else {
        assert.ok(result.text.startsWith(`import { Result } from "effect"\nimport { ${[...members].sort().join(", ")} } from "effect/Array"\n`), result.text)
        assert.doesNotMatch(result.text, /\bArr\b|\* as /)
        parse(result.text)
      }
    }), { numRuns: 40, seed: 4842 })
})
