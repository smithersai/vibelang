import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { block, chapter, read, run } from "./spec-witness.mjs"

const functions = () => process.env.SPEC_FUNCTIONS ? readFileSync(process.env.SPEC_FUNCTIONS, "utf8") : chapter("001-functions")

test("plain and Effect recursion have separate documented stack behavior", () => {
  const text = functions()
  assert.ok(text.includes("Plain functions have JavaScript's stack limit"))
  assert.ok(text.includes("Running a recursive Effect with `try` uses Effect's stack-safe execution"))
  assert.ok(read("docs/design/vips/0001-effect-and-async-functions.md").includes("Plain functions have JavaScript's stack limit"))
})

test("the printed counterpart runs deep Effect recursion and preserves the native stack limit", () => {
  const result = run(block(functions(), "function depthE") + [
    'import assert from "node:assert/strict"',
    'for (const n of [0, 1, 10, 1000, 100000]) assert.equal(Effect.runSync(depthE(n)), n)',
    'assert.equal(depth(10), 10)',
    'assert.throws(() => depth(100000), RangeError)',
  ].join("\n"))
  assert.equal(result.status, 0, result.stderr)
})
