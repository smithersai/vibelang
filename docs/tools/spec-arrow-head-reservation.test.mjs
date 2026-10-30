import assert from "node:assert/strict"
import { Script } from "node:vm"
import { test } from "node:test"
import { chapter, read, block, run } from "./spec-witness.mjs"

const parse = source => new Script(source)

test("native ordinary arrow heads inherit Await, including default and binding patterns", () => {
  for (const arrow of ["await => 1", "(await) => 1", "({ await }) => 1", "([await]) => 1", "(...await) => 1",
    "async await => 1", "async (await) => 1", "async ({ await }) => 1", "async ([await]) => 1", "async (...await) => 1",
    "(x = await 1) => x", "async (x = await 1) => x"]) {
    assert.throws(() => parse(`async function outer() { const f = ${arrow} }`), SyntaxError, arrow)
  }
  for (const source of [
    "async function outer() { function plain(await) { return await } }",
    "async function outer() { const f = async value => { const join = value; return await join } }",
    "function outer() { const f = (await) => await }",
    "const f = async (join) => join",
    "async function outer() { const f = async ({ await: value }) => value }",
    "async function outer() { const f = async ({ value = 1 }) => value }"]) {
    assert.doesNotThrow(() => parse(source), source)
  }
})

test("the source rule and EK1702 cover ordinary async heads without reserving their bodies", () => {
  const appendix = chapter("900-appendices")
  const running = chapter("002-running")
  const grammar = appendix.split("### The `[Effect]` parameter")[1].split("### Contextual keywords")[0]
  const row = appendix.split("\n").find(line => line.startsWith("| `EK1702` |"))
  const rule = running.split("### Static rules").find(section => section.includes("| `EK1702` |"))
  for (const [name, text] of [["grammar", grammar], ["Appendix B", row], ["canonical rule", rule]]) {
    assert.match(text, /plain or `async` arrow/, name)
  }
  assert.match(grammar, /enclosing.*reservation/)
  assert.match(grammar, /body.*own.*context/)
  assert.match(grammar, /Outside.*reservation.*ordinary.*identifiers/s)
  assert.ok(grammar.includes("sec-async-arrow-function-definitions"))
  const vip = read("docs/design/vips/0017-fork.md")
  assert.match(vip, /plain or `async` arrow/)
  assert.match(vip, /head.*body/s)
})

test("the checked admitted example retains an async body and a plain-function reset", () => {
  const running = chapter("002-running")
  const witness = block(running, "function arrowHeadNames()")
  const result = run(witness + "\nif (Effect.runSync(arrowHeadNames()) !== 7) throw 7\n")
  assert.equal(result.status, 0, result.stderr)
  assert.ok(witness.includes("async (value: number)"))
  assert.ok(witness.includes("function plain(join: number)"))
})
