import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"
test("the fourth migration warning is identity-selected and preserves local types",()=>{
 const text=chapter("007-tooling")
 for(const s of ["EK4856","resolved legacy symbol","local and imported types","coordinated compiler"]) assert.ok(text.includes(s),s)
 const row=chapter("900-appendices").split("\n").find(l=>l.startsWith("| `EK4856`"))
 assert.match(row,/warning:.*retired global/)
 assert.match(row,/A!E!R/)
 assert.match(read("docs/design/vips/0003-effect-type-shorthand.md"),/EK4856/)
})

// VIP-3 named only "an interface heritage element" and
// chapter 7 "where the syntax requires it". The amended VIP spells out both forms.
test("VIP-3 and chapter 7 retain manual alias forms and emitted declarations", () => {
  const vip = read("docs/design/vips/0003-effect-type-shorthand.md")
  const ch7 = chapter("007-tooling")
  for (const [name, text] of [["VIP-3", vip], ["007", ch7]]) {
    assert.ok(!text.includes("where the syntax requires it"), `${name}: vague trigger`)
    assert.ok(!text.includes("in an interface heritage element"), `${name}: interface-only trigger`)
    assert.ok(!text.includes("leaves declarations qualified"), `${name}: authored versus emitted declarations`)
    checkEmittedDeclarationContract(text, name)
  }
  for (const s of ["`Effect<number>` becomes `number!!`", "`Effect<A | B, E>`", "`Effect<A, E>[]`", "`extends` or `implements` heritage element"]) assert.ok(vip.includes(s), s)
  assert.match(ch7, /including heritage elements/)
})

function checkEmittedDeclarationContract(text, name) {
  assert.match(text, /[Ee]mitted declarations already (?:print|use) `Effect\.Effect<…>` and (?:do not change|stay unchanged)/, name)
}
