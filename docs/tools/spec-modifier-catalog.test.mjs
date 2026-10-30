import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"

test("recognized forbidden Effect modifiers have EK0108 without rejecting identifier-named methods", () => {
  for (const text of [chapter("001-functions"), chapter("900-appendices"), read("docs/design/vips/0001-effect-and-async-functions.md")]) {
    assert.ok(text.includes("EK0108"))
    for (const position of ["abstract", "ambient", "interface", "type literal"]) assert.ok(text.includes(position), position)
  }
  assert.match(chapter("001-functions"), /interface Ordinary \{ effect\(\): number \}/)
  assert.match(chapter("900-appendices"), /recovery positions/)
})

test("error members preserve both applicable Functions diagnostics without an extra body-category code", () => {
  const rule = chapter("003-failures").split("A member rejected by")[1].split("Otherwise a member")[0]
  assert.match(rule, /applicable.*diagnostics/)
  assert.match(rule, /no redundant error-body/)
  assert.match(rule, /both `EK0104` and `EK0105`/)
  assert.doesNotMatch(rule, /that diagnostic alone/)
  assert.match(chapter("001-functions"), /async effect get x\(\).*EK0104 and EK0105/)
})
