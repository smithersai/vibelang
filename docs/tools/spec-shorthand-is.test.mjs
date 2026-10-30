import assert from "node:assert/strict"
import test from "node:test"
import { chapter, block, run } from "./spec-witness.mjs"

test("shorthand recovery excludes every identifier-spelled expression operator", () => {
  const appendix = chapter("900-appendices")
  const production = appendix.match(/^EffectShorthand = (.+)$/m)?.[1]
  assert.ok(production)
  const exclusions = production.match(/lookahead ∉ \{ ([^}]+) \}/)?.[1].split(/,\s*/)
  assert.deepEqual(exclusions, ["as", "satisfies", "is"])
  for (const text of [chapter("001-functions"), appendix]) {
    assert.match(text, /name other than `as`, `satisfies` or `is`/)
  }
})

test("both statement-start is witnesses retain their expression behavior", () => {
  const appendix = chapter("900-appendices")
  assert.match(appendix, /effect is \(Point\) &&/)
  assert.match(appendix, /async is < 5 &&/)
  const result = run(block(appendix, "const operatorHeads", "ts effect") + "\nconsole.log(JSON.stringify(Effect.runSyncExit(operatorHeads)))\n")
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { _id: "Exit", _tag: "Success", value: 2 })
})
