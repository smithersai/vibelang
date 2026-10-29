import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
const pages = dir => readdirSync(new URL(`../../${dir}`, import.meta.url), { recursive: true })
  .filter(name => name.endsWith(".md")).map(name => `${dir}/${name}`)

test("no page says a platform value may be imported or passed (D310 amends D108)", () => {
  // The release notes and the decision log keep their history.
  const current = [...pages("docs/user/src"), ...pages("docs/design/src"), "packages/compiler/skills/vibelang/SKILL.md"]
    .filter(path => !path.endsWith("release-notes.md") && !path.endsWith("529-part5-ch29-decisions.md"))
  for (const path of current) {
    assert.ok(!/(?:importing|passing)[^.|\n]{0,60}(?:value|binding)[^.|\n]{0,30}\b(?:is|are) (?:allowed|fine)/i.test(read(path)), path)
  }
  assert.match(read("docs/design/history/src/428-part4-ch28-tooling.md"), /\| EK4402 \| [^\n]*held as a value[^\n]*\(D310/)
})

test("the skill sends a struct of named schemas to a schema declaration, as EK4832 does", () => {
  // EK4832 rewrites const T = Schema.Struct({ count: Schema.NumberFromString })
  // to schema T { count: Schema.NumberFromString }: a field names any schema,
  // a transformation included. Struct checks and optionalKey keep the constant.
  const data = read("packages/compiler/skills/vibelang/SKILL.md").split("\n").find(line => line.startsWith("- Data:"))
  assert.ok(data, "the skill's Data idiom")
  assert.doesNotMatch(data, /Schema\.Struct` for [^:]*transformations/)
  assert.match(data, /`schema` declarations, fields of any schema \(`Schema\.\w+From\w+`\)/)
  assert.match(data, /`Schema\.Struct` for struct checks and `optionalKey`/)
})

test("a block captioned as a test file imports what it tests, as a test file must", () => {
  // The snippet checker lets a later block see an earlier block's names, but a
  // reader who saves a captioned test file has only what it imports.
  const tests = pages("docs/user/src").flatMap(path => [...read(path).matchAll(/```vibe[^\n]*\n\/\/ ([\w./-]+\.test\.vibe)\n([\s\S]*?)```/g)]
    .map(m => ({ path, file: m[1], body: m[2] })))
  assert.ok(tests.length >= 7)
  for (const { path, file, body } of tests) assert.match(body, /^import \{[^}]+\} from "\.\/[\w./-]+\.vibe"$/m, `${path}: ${file}`)
})
