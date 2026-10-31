import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"

const require = createRequire(import.meta.url)
const effectTypes = (file) => readFileSync(join(dirname(require.resolve("effect/package.json")), "dist", file), "utf8")
const parses = (source) => {
  try { new Function(source); return true } catch (error) { if (error instanceof SyntaxError) return false; throw error }
}
const row = (text, code) => text.split("\n").filter((line) => line.startsWith("| ") && line.includes(`\`${code}\``))

const triggers = {
  EK1705: "`fork.other e`",
  EK1706: "`fork.in(s)` scope operand not assignable to `Scope.Scope`",
  EK1803: "`try.map x`",
  EK1907: "not assignable to",
}

test("each round-24 trigger has a 002 static-rule row and an Appendix B row", () => {
  const running = chapter("002-running")
  const appendix = chapter("900-appendices")
  for (const [code, trigger] of Object.entries(triggers)) {
    assert.ok(row(running, code).some((line) => line.includes(trigger) && line.endsWith(`| \`${code}\` |`)), `002 states ${code}`)
    assert.ok(row(appendix, code).some((line) => line.startsWith(`| \`${code}\` |`) && line.includes(trigger)), `Appendix B assigns ${code}`)
  }
  assert.ok(appendix.includes("Any other name after `try .` or `fork .` is a syntax error: `try.map x` is `EK1803` and `fork.other e` is `EK1705`."))
  // EK1802 keeps the meaning the compiler shipped: the retired await operations.
  assert.ok(row(running, "EK1802").some((line) => line.includes("a retired `await.all`")))
  assert.ok(row(appendix, "EK1802").some((line) => line.startsWith("| `EK1802` | a retired `await.all`")))
})

test("EK1702 covers a reserved shorthand property, as await does", () => {
  const running = chapter("002-running")
  assert.ok(row(running, "EK1702").some((line) => line.includes("A reserved `fork` or `join` as a shorthand property, `{ join }`, is the same error")))
  assert.ok(row(chapter("900-appendices"), "EK1702").some((line) => line.includes("shorthand property, `{ join }`")))
  assert.equal(parses("return async function f() { return { await } }"), false)
  assert.equal(parses("return async function f(o) { return { await: 1, x: o.await } }"), true)
})

test("EK1906 and EK2005 name every head other than const and let", () => {
  const running = chapter("002-running")
  for (const code of ["EK1906", "EK2005"]) {
    assert.ok(row(running, code).some((line) => line.includes("a head other than a `const` or `let` declaration: `var`, `using`, `await using` or an assignment head")), `002 ${code}`)
    assert.ok(row(chapter("900-appendices"), code).some((line) => line.includes("a `var`, `using`, `await using` or assignment head in") && line.includes("any head other than a `const` or `let` declaration")), `Appendix B ${code}`)
  }
})

test("the type triggers use Effect 4.1.0's own parameter types", () => {
  assert.match(effectTypes("Types.d.ts"), /export type Concurrency = number \| "unbounded";/)
  const forkIn = effectTypes("Effect.d.ts").split("export declare const forkIn:")[1].split("};")[0]
  assert.match(forkIn, /self: Effect<A, E, R>, scope: Scope,/)
  assert.ok(chapter("002-running").includes("a limit not assignable to Effect's `Types.Concurrency`, `number \\| \"unbounded\"`"))
})
