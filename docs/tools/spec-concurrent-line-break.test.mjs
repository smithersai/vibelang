import assert from "node:assert/strict"
import test from "node:test"
import { chapter, block, run } from "./spec-witness.mjs"

test("the concurrent-loop keyword boundary has native for-await whitespace", () => {
  const appendix = chapter("900-appendices")
  const production = appendix.match(/^ForConcurrent = (.+)$/m)?.[1]
  assert.ok(production, "the concurrent-loop production must exist")
  assert.match(production, /"for" "concurrent"/, "there is no special line-terminator restriction at this boundary")
  const row = appendix.split("\n").find(line => line.startsWith("| `concurrent` |"))
  assert.ok(row?.includes("line break allowed"), "the contextual keyword table must state the same boundary")
})

test("the printed multiline loop keeps the ordinary Effect counterpart", () => {
  const appendix = chapter("900-appendices")
  assert.match(appendix, /for\n\s+concurrent \(const x of \[1, 2\]\)/)
  const source = block(appendix, "const multilineTotal", "ts effect")
  const result = run(source + "\nconsole.log(JSON.stringify(Effect.runSyncExit(multilineTotal)))\n")
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { _id: "Exit", _tag: "Success", value: 3 })
})
