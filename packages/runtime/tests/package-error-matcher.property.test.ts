import { expect, test } from "bun:test"
import fc from "fast-check"

test("guarded entry exposes generated error matcher registration", async () => {
  const entry = await import("../dist/entry.js")
  const abi = await import("../dist/index.js")
  expect(typeof entry.$registerErrorMatcher).toBe("function")
  expect(entry.$registerErrorMatcher).toBe(abi.$registerErrorMatcher)
})
test("guarded generated matchers retain family matching across 500 subclass histories", async () => {
  const entry = await import("../dist/entry.js")
  await fc.assert(fc.property(fc.integer({ min: 1, max: 8 }), fc.string(), fc.boolean(), fc.boolean(), (depth, tag, registered, matching) => {
    const matcher = (subject: unknown) => typeof subject === "object" && subject !== null && (subject as { _tag?: unknown })._tag === tag
    if (registered) {
      expect(entry.$registerErrorMatcher(matcher)).toBe(matcher)
      expect(entry.$registerErrorMatcher(matcher)).toBe(matcher)
    }
    class Family {}
    Object.defineProperty(Family, entry.customMatcher, { value: matcher })
    let Child = Family
    for (let i = 0; i < depth; i++) Child = class extends Child {}
    const subject = { _tag: matching ? tag : tag + "\u0000" }
    expect(entry.$is(Child, subject)).toBe(registered && matching)
    if (!registered) expect(entry.$is(Child, new Child())).toBe(true)
  }), { seed: 531168, numRuns: 500 })
})
