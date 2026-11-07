import assert from "node:assert/strict"
import { test } from "node:test"
import fc from "fast-check"
import { checkRelativeUrlDocs, relativeUrlDocProblems } from "./relative-url-docs.mjs"

// Native URL semantics are the oracle for ordinary TypeScript adapters.
// https://url.spec.whatwg.org/#concept-basic-url-parser
const original = "https://example.test/src/module.ts"
const companion = "https://example.test/src/module.platform.ts"
const broadClaim = 'Any written path that is not empty and starts with neither `?` nor `#` drops the file name, so new URL(path, import.meta.url) names the same URL from the companion.'

test("published relative-URL guidance qualifies raw input before claiming relocation is safe", () => {
  assert.deepEqual(checkRelativeUrlDocs(), [])
})

test("leading URL controls invalidate the unqualified written-path claim", () => {
  for (const path of [" ", "\t", " ?q=1", "\n#part", "\u0000"]) {
    assert.ok(path.length && !["?", "#"].includes(path[0]))
    assert.notEqual(new URL(path, original).href, new URL(path, companion).href)
  }
  assert.equal(relativeUrlDocProblems(broadClaim).length, 1)
  assert.deepEqual(relativeUrlDocProblems(broadClaim + " References with leading whitespace remain in TypeScript."), [])
  assert.equal(new URL("results/", original).href, new URL("results/", companion).href)
})

test("generated controls preserve URL file identity after input normalization", () => {
  fc.assert(fc.property(
    fc.array(fc.integer({ min: 0, max: 32 }), { minLength: 1, maxLength: 8 }),
    fc.constantFrom("", "?q=1", "#part"),
    (codes, tail) => {
      const path = String.fromCharCode(...codes) + tail
      assert.ok(path.length && !["?", "#"].includes(path[0]))
      assert.notEqual(new URL(path, original).href, new URL(path, companion).href)
    }), { seed: 500050, numRuns: 400 })
})

test("the documentation check recognizes the claim across Markdown spacing", () => {
  fc.assert(fc.property(fc.constantFrom(" ", "\t", "\n", " \n "), gap => {
    const written = broadClaim.replaceAll(" ", gap)
    assert.equal(relativeUrlDocProblems(written).length, 1)
    assert.deepEqual(relativeUrlDocProblems(written + gap + "References with leading whitespace remain in TypeScript."), [])
  }), { seed: 500051, numRuns: 100 })
})
