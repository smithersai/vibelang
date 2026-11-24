import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { originalFunctions, runPhaseOf } from "../lib/run-phase.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/run-phase-binding-provenance.json", import.meta.url), "utf8"))
const { quote } = corpus
// The chapter writes **Migration** in Markdown.
const chapter = readFileSync(SpecPath("007-tooling.md"), "utf8").replaceAll("**", "")
const phase = source => {
  const shape = originalFunctions(ts, source).get("f")
  assert.equal(shape.kind, "plain")
  return runPhaseOf(ts, shape.node).verdict
}
const imports = [
  ["import { Effect as E } from 'effect';", "E"],
  ["import * as E from 'effect/Effect';", "E"],
  ["import * as E from 'effect';", "E.Effect"],
]
const wraps = fc.constantFrom(x => x, x => `(${x})`, x => `(${x} as any)`, x => `(${x})!`)
const body = fc.constantFrom(x => `export function f(){return ${x}}`, x => `export const f=()=>${x}`, x => `export const f=()=>{return ${x}}`)

test("run-phase binding oracle quotes the migration contract", () => assert.ok(chapter.includes(quote)))
for (const sample of corpus.samples) {
  test(`${corpus.key}:${sample.key}`, () => assert.equal(phase(sample.source), sample.verdict))
}

test("run-phase: local and shadowed gen bindings never certify coldness", () => {
  fc.assert(fc.property(fc.constantFrom("Effect", "Micro", "Stream", "Layer", "STM"), wraps, body, (name, wrap, fn) => {
    for (const prefix of ["", `const ${name}={gen:()=>7};`, `import {${name}} from 'unrelated';`, `import type {${name}} from 'effect';`]) {
      assert.notEqual(phase(prefix + fn(wrap(`${name}.gen(function*(){return 7})`))), "ok")
    }
    assert.notEqual(phase(`import {${name}} from 'effect'; export function f(${name}:any){return ${name}.gen(function*(){return 7})}`), "ok")
    assert.notEqual(phase(`import {${name}} from 'effect'; export function f(){const ${name}={gen:()=>7};return ${name}.gen()}`), "ok")
    assert.notEqual(phase(`import {${name}} from 'effect'; export function f(){ {let ${name}={gen:()=>7};return ${name}.gen()} }`), "ok")
  }), { seed: 7007372, numRuns: 100 })
})

test("run-phase: resolved imports and aliases retain cold generator bodies", () => {
  fc.assert(fc.property(fc.constantFrom(...imports), wraps, body, ([head, name], wrap, fn) => {
    assert.equal(phase(head + fn(wrap(`${name}.gen(function*(){trace();return 7})`))), "ok")
    assert.equal(phase(head + `export function f():${name}.Effect<number>{return ${name}.gen(function*(){return 7})}`), "ok")
    assert.equal(phase(head + `function other(E:any){return E.gen()};` + fn(wrap(`${name}.gen(function*(){return 7})`))), "ok")
  }), { seed: 7007373, numRuns: 100 })
})

test("run-phase: eager arguments, receivers and conditions move work to the run", () => {
  const eager = fc.constantFrom(
    name => `${name}.gen(makeGenerator())`,
    name => `${name}.gen((count++, function*(){return 7}))`,
    name => `${name}.gen({self: load()}, function*(){return 7})`,
    name => `choose() ? ${name}.gen(function*(){return 7}) : ${name}.gen(function*(){return 8})`,
    name => `(getNamespace(), ${name}).gen(function*(){return 7})`,
  )
  fc.assert(fc.property(fc.constantFrom(...imports), eager, wraps, body, ([head, name], expr, wrap, fn) => {
    assert.equal(phase(head + fn(wrap(expr(name)))), "eager")
  }), { seed: 7007374, numRuns: 100 })
})

test("run-phase: mutated, escaped, optional or opaque generator calls need review", () => {
  for (const [head, name] of imports) {
    for (const prefix of [`${name}.gen = replacement;`, `const alias=${name};alias.gen=replacement;`, `mutate(${name});`]) {
      assert.notEqual(phase(head + prefix + `export function f(){return ${name}.gen(function*(){return 7})}`), "ok")
    }
    for (const expr of [`${name}.gen(generator)`, `${name}.gen?.(function*(){return 7})`, `${name}.gen(function(){return 7})`]) {
      assert.notEqual(phase(head + `export function f(){return ${expr}}`), "ok")
    }
  }
})

test("run-phase: a shadowed fn factory is not an established Effect function", () => {
  const shape = originalFunctions(ts, "const Effect={fn:()=>()=>7};export const f=Effect.fn() ").get("f")
  assert.notEqual(shape?.kind, "effect")
})

// #526: a member read is not an escape. Only the namespace leaving or a
// member write voids the proof.
test("run-phase: a member read such as Effect.void keeps every proof", () => {
  const head = 'import { Effect } from "effect";\n'
  for (const [fn, verdict] of [["export const f = () => Effect.succeed(load())", "eager"],
    ["export const f = () => Effect.gen(function*(){ return 7 })", "ok"]]) {
    assert.equal(phase(head + fn), verdict)
    for (const read of ["const noop = Effect.void;", "export const g = Effect.void;", "const h = (x: any) => Effect.map(x, Effect.succeed);",
      "const k = () => Effect.gen(function*(){ yield* Effect.void });", "const l = [Effect.never, { a: Effect.void }];"]) {
      assert.equal(phase(head + read + "\n" + fn), verdict, read)
    }
  }
  for (const escape of ["const alias = Effect;", "mutate(Effect);", "(Effect as any).gen = () => 7;", "Effect.gen = (() => 7) as any;",
    "delete (Effect as any).gen;", "[(Effect as any).gen] = [() => 7];", "({ a: (Effect as any).gen } = { a: () => 7 });"]) {
    assert.notEqual(phase(head + escape + "\nexport const f = () => Effect.gen(function*(){ return 7 })"), "ok", escape)
  }
})
