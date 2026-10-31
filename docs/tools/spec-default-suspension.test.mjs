import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"

const parses = (source) => {
  try { new Function(source); return true } catch (error) { if (error instanceof SyntaxError) return false; throw error }
}

test("a suspension in a default follows await: destructuring defaults in effect code, never parameter defaults", () => {
  const bullet = chapter("002-running").split("\n").find((line) => line.startsWith("- **A suspension.**"))
  assert.ok(bullet, "002 lists what a suspension in a default does")
  assert.doesNotMatch(bullet, /A `try` or `yield` in a default runs/, "a parameter default is not effect code")
  assert.match(bullet, /A `try` in a destructuring default in effect code runs in the enclosing effect function/)
  assert.match(bullet, /A parameter default can't suspend \(\[below\]\(#parameter-defaults\)\)/)
})

test("await and yield suspend in a destructuring default and are SyntaxErrors in a parameter default", () => {
  assert.equal(parses("return async function f(o, p) { const { x = await p } = o; return x }"), true)
  assert.equal(parses("return async function f(p, x = await p) { }"), false)
  assert.equal(parses("return function* g(o) { const { x = yield 1 } = o }"), true)
  assert.equal(parses("return function* g(x = yield 1) { }"), false)
})

test("await in a destructuring default suspends the enclosing async function", async () => {
  const order = []
  async function f(o) {
    order.push("start")
    const { x = await Promise.resolve(7) } = o
    order.push("resumed")
    return x
  }
  const pending = f({})
  order.push("caller")
  assert.equal(await pending, 7)
  assert.deepEqual(order, ["start", "caller", "resumed"])
})
