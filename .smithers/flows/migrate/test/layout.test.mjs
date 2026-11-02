// A step's result literal lists one property per line. Lanes add result fields
// often, and two lanes adding fields to a one-line literal edit the same line:
// 5 of 7 merge-queue conflict rejections on lib/steps.mjs from 2026-11-01
// 02:20Z to 13:10Z were two sides of `const result = { batch: b, ... }`.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const steps = readFileSync(new URL("../lib/steps.mjs", import.meta.url), "utf8")

test("each step's result literal lists one property per line", () => {
  const oneLine = steps.split("\n")
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /^\s*const result = \{.*,.*\}\s*$/.test(line))
    .map(([n]) => `lib/steps.mjs:${n}`)
  assert.deepEqual(oneLine, [])
})
