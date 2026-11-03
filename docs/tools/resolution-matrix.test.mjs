import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { matrix } from "../../scripts/resolution-matrix.mjs"
test("the recorded resolution matrix equals every TypeScript 5.9.3 cell", () => {
  const recorded = JSON.parse(readFileSync(new URL("../design/resolution-matrix.json", import.meta.url)))
  assert.equal(recorded.rows.length, 384)
  assert.deepEqual(matrix(), recorded)
})
