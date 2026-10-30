import assert from "node:assert/strict"
import { test } from "node:test"
import { block, chapter, read } from "./spec-witness.mjs"

const nolt = "[no LineTerminator here]"

test("every ! in EffectType has one line-break rule", () => {
  const productions = block(chapter("900-appendices"), "EffectType =", "text").trim().split("\n")
  assert.equal(productions.length, 4)
  for (const line of productions) {
    const body = line.replace(/^\s*(?:EffectType =|\|)\s*/, "").replace(/\s+\([^()]*\)$/, "")
    const parts = body.split('"!"')
    for (let i = 0; i < parts.length - 1; i++) {
      assert.ok(parts[i].trimEnd().endsWith(nolt), `no restriction before ! in: ${line}`)
      if (i + 1 < parts.length - 1 || parts[i + 1].trim()) {
        assert.ok(parts[i + 1].trimStart().startsWith(nolt), `no restriction after ! in: ${line}`)
      }
    }
  }
})

test("the precedent the rule cites is the parser's loop", () => {
  const parser = read("typescript/tsc/internal/parser/parser.go")
  const start = parser.indexOf("func (p *Parser) parsePostfixTypeOrHigher()")
  assert.ok(start > 0)
  assert.match(parser.slice(start, start + 200), /for !p\.hasPrecedingLineBreak\(\) \{/)
})

test("chapter 1 and Appendix A state the same rule", () => {
  assert.match(chapter("001-functions"), /A line break ends an Effect type/)
  assert.match(chapter("900-appendices"), /a line break ends an Effect type/)
  assert.doesNotMatch(chapter("001-functions"), /`!` continues a type only on the same line/)
})
