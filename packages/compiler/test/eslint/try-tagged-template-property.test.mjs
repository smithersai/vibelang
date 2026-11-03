// try before a tagged template runs its Effect, as try before a call does, so
// ESLint's no-unused-expressions must not report the statement: t3code's
// statement try sql`VACUUM INTO ${target}` once did. The same template without try is
// still an unused expression.
import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { Linter } from "eslint"
import vibelang from "../../eslint.mjs"

const filename = new URL("./try.vibe", import.meta.url).pathname
const lint = (code) => new Linter({ configType: "flat", cwd: "/" }).verify(code, [{
  files: ["**/*.vibe"], languageOptions: { parser: vibelang },
  rules: { "no-unused-expressions": "error", "no-undef": "error" }
}], { filename })

const tag = fc.constantFrom("sql", "db.sql", "html", "Sql.unsafe")
const text = fc.stringMatching(/^[A-Za-z ]{0,12}$/)
const holes = fc.array(fc.constantFrom("target", "1", "target.length"), { maxLength: 2 })
const template = fc.tuple(text, holes).map(([head, list]) => "`" + head + list.map((hole) => "${" + hole + "} " + head).join("") + "`")

const program = (statement) => [
  "declare const sql: (s: TemplateStringsArray, ...a: unknown[]) => unknown",
  "declare const html: typeof sql",
  "declare const db: { sql: typeof sql }",
  "declare const Sql: { unsafe: typeof sql }",
  "export const run = (target: string) => effect {",
  "  " + statement,
  "  return target",
  "}"
].join("\n")

test("a tried tagged template statement is not an unused expression; an untried one is", () => {
  fc.assert(fc.property(tag, template, (name, quasi) => {
    const tried = lint(program("try " + name + quasi))
    assert.deepEqual(tried, [], program("try " + name + quasi))
    const bare = lint(program(name + quasi))
    assert.deepEqual(bare.map((message) => message.ruleId), ["no-unused-expressions"], program(name + quasi))
    assert.equal(bare[0].line, 6)
    assert.equal(bare[0].column, 3)
  }), { seed: 112, numRuns: 120 })
})

test("t3code's CookieDatabase statement lints clean and keeps scope diagnostics", () => {
  const code = [
    "declare const sql: (s: TemplateStringsArray, ...a: unknown[]) => unknown",
    "export const copy = (target: string) => effect {",
    "  try sql`VACUUM INTO ${target}`",
    "  try missing`x`",
    "  return target",
    "}"
  ].join("\n")
  assert.deepEqual(lint(code).map(({ ruleId, message, line }) => ({ ruleId, message, line })), [
    { ruleId: "no-undef", message: "'missing' is not defined.", line: 4 }
  ])
})

test("no rule reports the $try a try before a non-call operand writes", () => {
  const code = [
    "declare const program: unknown",
    "export const run = effect {",
    "  const n = try program",
    "  try program",
    "  return n",
    "}"
  ].join("\n")
  assert.deepEqual(lint(code), [])
})
