import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { runPhaseOf } from "../lib/run-phase.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")

// The verdict for an original plain function, from its text alone.
const verdict = body => {
  const source = ts.createSourceFile("main.ts", 'import { Effect } from "effect"; export const f = (x: any) => ' + body, ts.ScriptTarget.Latest, true)
  const declaration = source.statements[1].declarationList.declarations[0]
  return runPhaseOf(ts, declaration.initializer).verdict
}

const values = ["{ a: x }", "[x]", "class {}", "\"s\"", "1", "`t${x}`", "new Map()", "Object.assign(class {}, x)", "JSON.parse(x)", "(y: any) => y", "x + 1", "undefined", "null", "true"]
const programs = ["Effect.gen(function* () { return x })", "Effect.gen({ self: x }, function* () { return 1 })"]
const opaque = ["x.pipe(Effect.map((y: any) => y))", "Effect.succeed(x)", "helper(x)", "x"]
const wrap = fc.constantFrom(e => e, e => `(${e})`, e => `(${e} as any)`, e => `(${e} satisfies unknown)`, e => `(${e})!`)
const eager = ["if (!x) throw new Error(\"e\")", "log(x)", "count++", "x.y = 1", "const v = load(x)", "for (const i of x) use(i)"]
const pure = ["const v = x.y", "const n = 1", "let m: number"]

test("alchemy-62: a returned value is a value however it is parenthesized or cast", () => {
  fc.assert(fc.property(fc.constantFrom(...values), wrap, (value, w) => verdict(w(value)) === "value"))
})

test("alchemy-62: an Effect.gen body keeps its run phase under any wrapper", () => {
  fc.assert(fc.property(fc.constantFrom(...programs), wrap, (program, w) => verdict(w(program)) === "ok"))
})

test("alchemy-62: a conditional takes its worst branch", () => {
  fc.assert(fc.property(fc.constantFrom(...values), fc.constantFrom(...programs), fc.boolean(), (value, program, first) => {
    const [a, b] = first ? [value, program] : [program, value]
    return verdict(`x ? ${a} : ${b}`) === "value"
  }))
})

test("alchemy-62: work before the returned program moves to the run", () => {
  fc.assert(fc.property(fc.constantFrom(...eager), fc.constantFrom(...programs), (statement, program) =>
    verdict(`{ ${statement}; return ${program} }`) === "eager"))
})

test("alchemy-62: pure declarations before the returned program keep it ok", () => {
  fc.assert(fc.property(fc.subarray(pure), fc.constantFrom(...programs), (statements, program) =>
    verdict(`{ ${statements.map(s => s + "; ").join("")}return ${program} }`) === "ok"))
})

test("alchemy-62: work inside a nested function stays at that function's call", () => {
  fc.assert(fc.property(fc.constantFrom(...eager), fc.constantFrom(...programs), (statement, program) =>
    verdict(`{ const later = () => { ${statement} }; return ${program} }`) === "ok"))
})

// Chapter 007 / an opaque pairing is review and cannot certify preservation: docs/design/src/007-tooling.md#fde0659e475943d2
// Chapter 007 / an opaque pairing is review and cannot certify preservation: docs/design/src/007-tooling.md#602f94517600c73a
test("alchemy-62: an opaque return is listed for review, never ok or blocking", () => {
  fc.assert(fc.property(fc.constantFrom(...opaque), wrap, (expression, w) => verdict(w(expression)) === "review"))
})
