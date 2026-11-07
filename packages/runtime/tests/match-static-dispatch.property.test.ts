import { expect, test } from "bun:test"
import fc from "fast-check"
import { $extract, $is, customMatcher } from "../src/match.js"

const generatedIs = $is as (...args: unknown[]) => unknown
const generatedExtract = $extract as (...args: unknown[]) => unknown

// Chapter 004: a construct signature selects `instanceof`, including ES5 constructors declared as constructable
// call signatures only select `C(subject, { matchType })`, preserving a member receiver.
test("static call dispatch ignores prototype members and preserves receivers and hints", () => {
  fc.assert(fc.property(fc.integer(), fc.integer(), fc.boolean(), (value, limit, decorated) => {
    const events: unknown[] = []
    function predicate(this: { limit: number }, input: unknown, hint: { matchType: string }) {
      events.push([this, hint.matchType])
      return typeof input === "number" && input > this.limit
    }
    function extractor(this: { limit: number }, input: unknown, hint: { matchType: string }) {
      events.push([this, hint.matchType])
      return typeof input === "number" && input > this.limit ? [input] : false
    }
    if (decorated) {
      predicate.prototype.marker = true
      extractor.prototype.marker = true
    }
    const receiver = { limit }
    expect(generatedIs(predicate, value, receiver, true, "call")).toBe(value > limit)
    expect(generatedExtract(extractor, value, receiver, true, "call")).toEqual(value > limit ? [value] : false)
    expect(events).toEqual([[receiver, "boolean"], [receiver, "extractor"]])
  }), { numRuns: 150 })
})

test("static constructor dispatch recognizes ordinary functions and bound classes", () => {
  fc.assert(fc.property(fc.integer(), fc.boolean(), (value, bound) => {
    class Box { constructor(readonly value: number) {} }
    const Constructor = bound ? Box.bind(undefined, value) : function () {}
    const instance = Reflect.construct(Constructor, [])
    expect(generatedIs(Constructor, instance, null, true, "construct")).toBe(true)
    expect(generatedIs(Constructor, {}, null, true, "construct")).toBe(false)
  }), { numRuns: 100 })
})

test("an own custom matcher still precedes static dispatch", () => {
  fc.assert(fc.property(fc.integer(), value => {
    function matcher() { return false }
    const hints: string[] = []
    Object.defineProperty(matcher, customMatcher, { value(input: number, hint: { matchType: string }) {
      hints.push(hint.matchType)
      return hint.matchType === "boolean" ? input === value : [input]
    } })
    for (const dispatch of ["call", "construct"]) {
      expect(generatedIs(matcher, value, null, true, dispatch)).toBe(true)
      expect(generatedExtract(matcher, value, null, true, dispatch)).toEqual([value])
    }
    expect(hints).toEqual(["boolean", "extractor", "boolean", "extractor"])
  }), { numRuns: 100 })
})
