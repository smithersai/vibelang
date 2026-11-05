import { expect, test } from "bun:test"
import fc from "fast-check"
import { $extract, $is, customMatcher } from "../src/match.js"

// The final argument is private compiler emission, absent from public overloads.
const patternIs = $is as (...args: unknown[]) => boolean
const patternExtract = $extract as (...args: unknown[]) => unknown

test("generated class lookup does not read an inherited matcher", () => {
  fc.assert(fc.property(fc.constantFrom("throw", "function", "undefined"), fc.integer({ min: 1, max: 8 }), (kind, repeats) => {
    let inheritedReads = 0
    class Base {}
    Object.defineProperty(Base, customMatcher, { get() {
      inheritedReads++
      if (kind === "throw") throw new Error("inherited")
      return kind === "function" ? () => false : undefined
    } })
    class Derived extends Base {}
    const instance = new Derived()
    for (let i = 0; i < repeats; i++) {
      expect(patternIs(Derived, instance, null, true)).toBe(true)
      expect(patternIs(Derived, {}, null, true)).toBe(false)
      expect(patternExtract(Derived, {}, null, true)).toBe(false)
      expect(() => patternExtract(Derived, instance, null, true)).toThrow(TypeError)
    }
    expect(inheritedReads).toBe(0)
    // The direct ABI keeps its existing registration lookup path.
    if (kind === "throw") expect(() => $is(Derived, instance)).toThrow("inherited")
    else expect($is(Derived, instance)).toBe(true)
    expect(inheritedReads).toBe(1)
  }), { numRuns: 100 })
})
