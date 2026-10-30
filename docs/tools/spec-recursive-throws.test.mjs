import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

const failures = () => process.env.SPEC_FAILURES ? readFileSync(process.env.SPEC_FAILURES, "utf8") : chapter("003-failures")

test("expanding recursive thrown summaries have a representable conservative bound", () => {
  const text = failures()
  assert.match(text, /finite representable stable contract/)
  assert.match(text, /widen.*`unknown`/)
  assert.match(text, /written checked upper bound.*cuts.*inference dependency/)
  assert.match(text, /@throws \{unknown\}/)
  assert.match(text, /mutual recursion/)
})

test("the documented polymorphic recursion throws every nesting depth", () => {
  const result = run(block(failures(), "function grow<T>") + `
import assert from "node:assert/strict"
import { Exit } from "effect"
for (const depth of [0, 1, 2, 4]) {
  let expected: unknown = 7
  for (let i = 0; i < depth; i++) expected = [expected]
  const observed = Effect.runSyncExit(Effect.try({ try: () => grow(7, depth), catch: e => e }))
  assert.equal(Exit.isFailure(observed), true)
  assert.deepEqual(observed.cause.reasons[0].error, expected)
}
`)
  assert.equal(result.status, 0, result.stderr)
})
