import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { Linter } from "eslint"
import fc from "fast-check"
import vibelang from "../../eslint.mjs"

const lint = source => new Linter().verify(source, [{
  files: ["**/*.vibe"], languageOptions: { parser: vibelang },
  rules: { "no-unreachable": "error", "no-unused-labels": "error", "no-labels": "error" },
}], { filename: "t3code-match.vibe" })

test("t3code: a do expression with a match has a reachable completion", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-match-codepaths.json", import.meta.url), "utf8"))
  for (const source of corpus.sources) assert.deepEqual(lint(source), [], source)
})

test("match reachability keeps reporting unreachable statements written by the user", () => {
  const source = "function f(n: number) { const a = do { match (n) { when 0: 1; default: 2; } }; return a; missing(); }"
  const messages = lint(source)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].ruleId, "no-unreachable")
  assert.equal(messages[0].column, source.indexOf("missing()") + 1)
})

test("property: match arms, nesting and do contexts preserve reachable completions", () => {
  fc.assert(fc.property(fc.integer({ min: 0, max: 5 }), fc.boolean(), fc.boolean(), (arms, arrow, throwingDefault) => {
    const clauses = Array.from({ length: arms }, (_, i) => `when ${i}: ${i + 1};`).join(" ")
    const fallback = throwingDefault && arms > 0 ? 'throw new Error("missing")' : "do { match (n) { when -1: 10; default: 11; } }"
    const block = `do { const x = n; match (x) { ${clauses} default: ${fallback}; } }`
    const source = arrow ? `const f = (n: number) => ${block};` : `function f(n: number) { const result = ${block}; return result; }`
    assert.deepEqual(lint(source), [], source)
  }), { numRuns: 80 })
})
