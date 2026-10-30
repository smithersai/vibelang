import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read, block } from "./spec-witness.mjs"

test("optional R prefers an ordinary source type and excludes parser-only JSDoc forms", () => {
  const appendix = chapter("900-appendices")
  const section = appendix.split("#### EffectType")[1].split("#### TryExpression")[0]
  assert.match(section, /prefer the present `R`/)
  assert.match(section, /negative literal type/)
  assert.match(section, /ordinary TypeScript source types/)
  for (const form of ["`?T`", "`T?`", "`!T`", "`*`"]) assert.ok(section.includes(form))
  assert.match(section, /inside parentheses/)
  assert.match(chapter("001-functions"), /negative literal type.*consumed as `R`/)
  assert.match(read("docs/design/vips/0003-effect-type-shorthand.md"), /prefer the present `R`/)
})

test("the examples distinguish omitted R, a negative R and an explicitly separated subtraction", () => {
  const appendix = chapter("900-appendices")
  assert.match(appendix, /number!!-1/)
  assert.match(appendix, /x as number!! \? 1 : 2/)
  assert.match(appendix, /x as number!! \* 2/)
  assert.match(appendix, /x as number!! - 1/)
  assert.match(appendix, /\(x as number!!\) - 1/)
  const ts = block(appendix, "type NegativeRequirement", "ts effect")
  assert.match(ts, /Effect\.Effect<number, never, -1>/)
  assert.equal((ts.match(/@ts-expect-error/g) ?? []).length, 2)
})
