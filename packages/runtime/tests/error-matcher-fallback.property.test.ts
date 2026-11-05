import { expect, test } from "bun:test"
import fc from "fast-check"
import { Data } from "effect"
import { $extract, $is, customMatcher } from "../src/match.js"
import { $errorSubclass, $schemaErrorMatcher, TaggedError } from "../src/prelude.js"

test("private error factory bases retain native fallback after deleting an own matcher", () => {
  try {
    fc.assert(fc.property(fc.string(), fc.boolean(), fc.integer({ min: 1, max: 5 }), (tag, inherited, repeats) => {
    class Parent extends Data.TaggedError("Parent")<{ readonly n: number }> {}
    const Base: any = inherited ? $errorSubclass(Parent, tag) : TaggedError(tag)
    class Declared extends Base {}
    $schemaErrorMatcher(Declared, tag, true)
    const instance = new Declared({ n: 1 })
    const copy = { _tag: tag }
    const method = Reflect.get(Declared, customMatcher)
    for (let i = 0; i < repeats; i++) {
      expect($is(Declared, copy)).toBe(true)
      expect(($extract(Declared, copy) as [unknown])[0]).toBe(copy)
      expect(Reflect.deleteProperty(Declared, customMatcher)).toBe(true)
      expect($is(Declared, copy)).toBe(false)
      expect($is(Declared, instance)).toBe(true)
      expect($extract(Declared, copy)).toBe(false)
      expect(() => $extract(Declared, instance)).toThrow(TypeError)
      Object.defineProperty(Declared, customMatcher, { value: method, configurable: true, writable: true })
    }
    // Direct runtime factory consumers keep their legacy family contract.
    class Legacy extends TaggedError(tag) {}
    expect($is(Legacy, copy)).toBe(true)
    }), { numRuns: 100 })
  } catch (error) {
    const failure = error as Error & { cause?: unknown }
    throw new Error(failure.message + "\n" + String(failure.cause), { cause: failure })
  }
})
