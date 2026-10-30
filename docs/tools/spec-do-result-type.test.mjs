import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")

test("do result types preserve source completions and ordinary expression contexts", () => {
  const text = running()
  assert.doesNotMatch(text, /literals widen as in a `let` initializer/)
  assert.match(text, /fresh literal/)
  assert.match(text, /`UpdateEmpty`/)
  assert.match(text, /no normal.*`never`/)
  assert.match(text, /Contextual typing/)
})

test("the printed type witness distinguishes const, let, annotations and generated return widening", () => {
  const source = block(running(), "const literalSource =", "ts")
  for (const marker of ["literalSource", "ordinaryLet", "annotatedSource", "returnedTemporary", "effectOverload", "promiseOverload"]) {
    assert.ok(source.includes(marker), marker)
  }
  assert.match(source, /@ts-expect-error/)
})

test("native block completions preserve empty inheritance and consumed break values", () => {
  const controls = [
    ["{ 7; {} }", 7],
    ["{ label: { 7; break label; } }", 7],
    ["{}", undefined],
    ["{ 7; undefined; }", undefined],
    ['{ if (true) 1; else "a"; }', 1],
    ['{ if (false) 1; else "a"; }', "a"]
  ]
  for (const [source, expected] of controls) assert.equal(eval(source), expected)
})

test("an outward return supplies the enclosing Effect without a normal do result", () => {
  const result = run(block(running(), "function leaveDo()") + `
import assert from "node:assert/strict"
assert.equal(Effect.runSync(leaveDo()), 7)
`)
  assert.equal(result.status, 0, result.stderr)
})
