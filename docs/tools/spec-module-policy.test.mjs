import assert from "node:assert/strict"
import test from "node:test"
import { chapter, read } from "./spec-witness.mjs"

test("Vibe file kind is fixed before checking and independent of both prelude switches", () => {
  const section = chapter("001-functions").split("## Modules and the top level")[1].split("## Declaration output")[0]
  assert.match(section, /before binding and checking/)
  assert.match(section, /effectGlobals/)
  assert.match(section, /effectModules/)
  assert.match(section, /empty module marker/)
  assert.match(section, /sidecars/)
  assert.match(section, /ordinary TypeScript module emission and host rules/)
})

test("the accepted file-kind exception is explicit in configuration, VIPs and runtime guarantees", () => {
  for (const text of [chapter("007-tooling"), read("docs/design/vips/0030-config-files.md")]) {
    assert.match(text, /moduleDetection/)
    assert.match(text, /exception/)
    assert.match(text, /\.ts.*\.js/)
  }
  assert.match(read("docs/design/vips/0026-top-level-and-main.md"), /before binding and checking/)
  assert.match(chapter("008-runtime"), /module classification/)
})
