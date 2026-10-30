import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"
const failures = () => process.env.SPEC_FAILURES ? readFileSync(process.env.SPEC_FAILURES, "utf8") : chapter("003-failures")
const appendix = () => process.env.SPEC_APPENDICES ? readFileSync(process.env.SPEC_APPENDICES, "utf8") : chapter("900-appendices")

test("rejected callable modifiers keep every applicable Functions diagnostic", () => {
  for (const text of [failures(), appendix()]) {
    assert.doesNotMatch(text, /gets that diagnostic alone/)
    assert.match(text, /applicable .*Functions.* diagnostics/)
    assert.match(text, /no .*error-body category diagnostic/)
  }
  assert.match(failures(), /async effect get.*EK0104.*EK0105/)
})
