import assert from "node:assert/strict"
import test from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"

// VIP-4, amended 2026-10-31 (Will: "If you throw in vibelang itself in a sync function that's an error"):
// a .vibe callable has thrown type never, so overloads, declaration output and callbacks carry no inferred contract.
test("a local .vibe implementation throws never and meets every overload bound; its throw is EK0401", () => {
  assert.match(chapter("001-functions"), /A local `\.vibe` implementation has thrown type `never`, so it satisfies every exposed overload, an effectful overload's implicit `never` bound included\. A `throw` in it is `EK0401`/)
  assert.match(chapter("003-failures"), /A local `\.vibe` implementation has thrown type `never`, so it satisfies every exposed overload bound; a `throw` or a call known to throw in it is `EK0401` at that site\./)
})

test("declaration output writes @throws {never} on .vibe call signatures and no @rethrows", () => {
  const text = chapter("001-functions")
  assert.match(text, /Every other call signature the output emits carries `@throws \{never\}`, so a TypeScript reader doesn't fall back to the foreign default `unknown`/)
  assert.match(text, /\*\*No `@rethrows` is emitted\.\*\* A `\.vibe` file can't write `@throws` or `@rethrows` \(`EK0406`\)/)
  assert.doesNotMatch(text, /A written `@throws \{T\}` is a checked upper bound/)
  assert.doesNotMatch(text, /admitted thrown bound of `unknown`/)
  for (const m of text.matchAll(/```vibe es\n([\s\S]*?)```/g)) assert.doesNotMatch(m[1], /@throws|@rethrows/)
  // VIP-4, amended 2026-10-31: chapter 3 keeps @rethrows for foreign declarations only.
  assert.match(chapter("003-failures"), /`@rethrows` parameters exist only on `\.ts`, `\.d\.ts` and JavaScript declarations/)
})

test("the printed references distinguish a hidden synchronous throw, an unwrapped callback defect and a wrapped failure", () => {
  const result = run(block(chapter("001-functions"), "// Callable-contract reference witnesses"))
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), [["Die", "boom"], ["Die", "callback"], ["Fail", "callback"]])
})
