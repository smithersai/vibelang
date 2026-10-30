import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { repo, run, block } from "./spec-witness.mjs"

const root = process.env.SPEC_TYPE_BOUNDARY_ROOT ?? repo
const read = path => readFileSync(resolve(root, path), "utf8")
const appendix = () => read("docs/design/src/900-appendices.md")
const functions = () => read("docs/design/src/001-functions.md")

test("tuple optionality belongs to the enclosing element rather than a JSDoc slot", () => {
  const text = appendix()
  for (const form of ["[A!E?]", "[A!!?]", "[A!!-1?]"]) assert.ok(text.includes(form), "missing tuple boundary " + form)
  assert.ok(text.includes("omission") && text.includes("`undefined`"), "optional tuple access keeps native undefined")
  assert.ok(functions().includes("optional tuple element"), "chapter 001 links the enclosing tuple rule")
})

test("required object slots are distinct from the optional R function-body boundary", () => {
  const text = appendix()
  assert.ok(text.includes("A!{ reason: string }!{ service: number }"), "required object operands are admitted")
  assert.ok(text.includes("only to the optional `R` after `!!`"), "brace exclusion is narrow")
  assert.ok(text.includes("A!!({ service: number })"), "optional object requirement stays parenthesized")
})

test("angle and bracket continuations use the ordinary operand category", () => {
  const text = appendix()
  for (const form of ["x as A!! < 3", "A!!(<T>() => T)", "x as A!![0]", "(x as A!!)[0]"]) assert.ok(text.includes(form), "missing boundary " + form)
  assert.ok(text.includes("type-operator level"), "generic functions are not bare operands")
})

test("complete as and satisfies parses preserve contextual alias names", () => {
  const text = appendix()
  for (const form of ["x as A!! as B", "x as A!! satisfies B", "A!!as", "x as A!!as satisfies unknown"]) assert.ok(text.includes(form), "missing assertion boundary " + form)
  assert.ok(text.includes("complete source parses"), "priority excludes recovery trees")
  assert.ok(text.includes("no symbol lookup"), "alias resolution never selects a parse")
  const vip = read("docs/design/vips/0003-effect-type-shorthand.md")
  assert.ok(vip.includes("optional tuple") && vip.includes("complete source parses"), "public decision states the full operand rule")
})

test("the printed optional-element counterpart preserves omission and indexed undefined", () => {
  const source = block(appendix(), "function slotBoundaryWitness", "ts effect")
  const result = run(source + '\nconst exit = Effect.runSyncExit(slotBoundaryWitness())\nconsole.log(JSON.stringify(exit))\n')
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout.trim()), { _id: "Exit", _tag: "Success", value: [0, 0, true] })
})
