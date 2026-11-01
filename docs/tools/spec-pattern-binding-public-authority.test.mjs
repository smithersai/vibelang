import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"

const source = "../vips/0007-match.md#binding-homes-and-redeclarations"
const claims = [
  "Two top-level patterns that bind one name in the same lexical home are a redeclaration",
  "The statement body of `if`, `else`, `for`",
  "A binding in a `for concurrent` limit belongs to the nearest home that encloses the loop",
  "The same holds for a catch clause's parameter, whose environment is distinct from the catch Block"
]

test("pattern binding clarifications cite their public VIP-7 authority", () => {
  const text = chapter("004-match")
  for (const claim of claims) {
    const line = text.split("\n").find(line => line.includes(claim))
    assert.ok(line, `missing binding rule: ${claim}`)
    assert.doesNotMatch(line, /\b(?:decided )?details?\s+\d/i)
    assert.ok(line.includes(source), `missing public authority: ${claim}`)
  }
})

test("the accepted public amendment states all four binding clarifications", () => {
  const vip = read("docs/design/vips/0007-match.md")
  assert.match(vip, /\*\*Status:\*\* accepted/)
  const start = vip.indexOf("### Binding homes and redeclarations")
  assert.ok(start >= 0, "missing public binding-home amendment")
  const section = vip.slice(start).split(/\n## /)[0]
  assert.doesNotMatch(section, /\b(?:decided )?details?\s+\d/i)
  for (const claim of claims) assert.ok(section.includes(claim), `amendment omits: ${claim}`)
})
