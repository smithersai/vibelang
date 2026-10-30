import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

const grammar = () => chapter("900-appendices")
const production = (name) => {
  const matches = [...grammar().matchAll(/```text\n([\s\S]*?)```/g)].filter(m => new RegExp("^" + name + "\\s*=", "m").test(m[1]))
  assert.equal(matches.length, 1, "missing or duplicate production " + name)
  return matches[0][1]
}

test("effect overload signatures are confined to function declarations and class methods", () => {
  assert.match(production("EffectFunction"), /EffectFunctionOverload/)
  assert.match(production("EffectFunctionOverload"), /declarations only/)
  assert.match(production("EffectMethod"), /EffectClassMethod \| EffectObjectMethod/)
  assert.match(production("EffectClassMethod"), /\(Block \| ";"\)/)
  assert.match(production("EffectObjectMethod"), /Block/)
  assert.doesNotMatch(production("EffectObjectMethod"), /";"|Block\?/)
  assert.match(grammar(), /Function expressions, object-literal methods and arrows still require bodies/)
  assert.match(grammar(), /starred overload signatures/)
})

test("class decorators stay on class elements, including producers and accessor recovery", () => {
  for (const name of ["EffectClassMethod", "ProducerMethod", "EffectAccessor"]) {
    assert.match(production(name), /DecoratorList\? Modifiers\?/)
  }
  assert.doesNotMatch(production("EffectObjectMethod"), /DecoratorList|Modifiers/)
  assert.match(chapter("001-functions"), /decorator list precedes the class modifiers/)
})

test("both error forms admit the ordinary TypeScript class-method category, including overloads", () => {
  assert.match(production("ErrorBody"), /ClassMethod/)
  assert.doesNotMatch(production("ErrorBody"), /MethodDefinition/)
  assert.match(production("ClassMethod"), /TypeScript.*overload signatures/)
  assert.match(production("RejectedElement"), /ClassMethod/)
  assert.match(chapter("003-failures"), /\[ClassMethod\]\(900-appendices.md#classmethod\)/)
})

test("the printed overload counterparts expose both call types and preserve successful execution", () => {
  for (const [page, marker] of [["001-functions", "// Overload-position counterpart"], ["003-failures", "// Error-method overload counterpart"]]) {
    const result = run(block(chapter(page), marker))
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), ["ok", 7])
  }
})
