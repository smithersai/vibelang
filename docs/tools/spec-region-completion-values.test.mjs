import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")

test("transparent regions preserve observable normal and jump completion values", () => {
  const text = running()
  assert.match(text, /completion kind, value.*target/)
  assert.match(text, /normal value or empty completion/)
  const result = run(block(text, "const providedCompletion =") + `
import assert from "node:assert/strict"
assert.deepEqual(Effect.runSync(regionCompletions), [7, 7, 7, 7, 5, 7, undefined])
const failed = Effect.runSyncExit(cleanupBeforeValue)
assert.equal(failed._tag, "Failure")
assert.deepEqual(failed.cause.reasons.map(r => [r._tag, r.defect]), [["Die", "cleanup"]])
`)
  assert.equal(result.status, 0, result.stderr)
})
