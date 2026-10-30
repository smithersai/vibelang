import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

test("negation complements the selected recognition test on every dispatch path", () => {
  const source = read("docs/design/vips/0007-match.md")
  assert.match(source, /negation follows actual recognition/)
  for (const text of ["primitive/built-in adapters", "retained Effect patterns", "generated tagged errors",
    "own matchers or predicates", "boolean`-returning matcher establishes no narrowing",
    "adds no exhaustiveness coverage for `not`"]) assert.ok(source.includes(text), text)
  assert.match(read("docs/design/vips/0007-match.md"), /negation follows actual recognition/)
  const result = run(block(source, "const complementMatcher") + `
if (!Exit.isSuccess(matcherExit)) throw new Error("failed Exit")
if (JSON.stringify(matcherExit.value) !== JSON.stringify([true,"number",0,8])) throw new Error("wrong complement")
`)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
