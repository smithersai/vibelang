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

// Loop round 15 OPUS-3: VIP-3 named only "an interface heritage element" and
// chapter 7 "where the syntax requires it". Decided detail 260 (2026-11-02):
// shorthand only without new parentheses, qualified everywhere else.
test("VIP-3 and chapter 7 give EK4856's repair one trigger", () => {
  const vip = read("docs/design/vips/0003-effect-type-shorthand.md")
  const ch7 = chapter("007-tooling")
  for (const [name, text] of [["VIP-3", vip], ["007", ch7]]) {
    assert.ok(text.includes("without new parentheses") || text.includes("needs no new parentheses"), `${name}: no-new-parentheses trigger`)
    assert.ok(!text.includes("where the syntax requires it"), `${name}: vague trigger`)
    assert.ok(!text.includes("in an interface heritage element"), `${name}: interface-only trigger`)
    assert.ok(!text.includes("leaves declarations qualified"), `${name}: authored versus emitted declarations`)
    assert.ok(text.includes("emitted declarations already print `Effect.Effect<…>`") || text.includes("Emitted declarations already print `Effect.Effect<…>`"), `${name}: emitted declarations unchanged`)
  }
  for (const s of ["`Effect<number>` becomes `number!!`", "`Effect<A | B, E>`", "`Effect<A, E>[]`", "`extends` or `implements` heritage element", "the fix is refused"]) assert.ok(vip.includes(s), s)
  assert.ok(ch7.includes("heritage elements included"))
})
