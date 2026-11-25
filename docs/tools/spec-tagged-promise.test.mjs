import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"
const failures = () => process.env.SPEC_FAILURES ? readFileSync(process.env.SPEC_FAILURES, "utf8") : chapter("003-failures")
const appendix = () => process.env.SPEC_APPENDICES ? readFileSync(process.env.SPEC_APPENDICES, "utf8") : chapter("900-appendices")

test("both EK0404 trigger lists include a tagged-template invocation", () => {
  for (const text of [failures(), appendix()]) {
    const row = text.split("\n").find(line => line.startsWith("|") && line.includes("EK0404"))
    assert.match(row, /tagged template/)
  }
  assert.match(failures(), /selected tag signature/)
})

test("the printed explicit Promise bridge executes the original tag and succeeds", () => {
  const result = run(block(failures(), "function wrappedTag()") + `
import assert from "node:assert/strict"
const exit = await Effect.runPromiseExit(wrappedTag())
assert.equal(exit._tag, "Success")
assert.equal(exit.value, 7)
`)
  assert.equal(result.status, 0, result.stderr)
})
