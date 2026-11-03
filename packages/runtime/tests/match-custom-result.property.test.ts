import { expect, test } from "bun:test"
import fc from "fast-check"
import { $extract, customMatcher } from "../src/match"

// Chapter 004: "Successful custom extractor results must be objects."
// InvokeCustomMatcher in the VIP-7 draft admits only false before this check.
test("custom-extractor-result-validation: every nonobject except false throws", () => {
  const primitive = fc.oneof(
    fc.constant(true), fc.integer(), fc.double(), fc.string(), fc.bigInt(),
    fc.constant(null), fc.constant(undefined), fc.constant(Symbol("result"))
  )
  fc.assert(fc.property(primitive, fc.jsonValue(), (result, subject) => {
    const calls: unknown[] = []
    const matcher = {
      [customMatcher](s: unknown, hint: unknown) {
        expect(this).toBe(matcher)
        calls.push([s, hint])
        return result
      }
    }
    expect(() => $extract(matcher, subject)).toThrow(TypeError)
    expect(calls).toEqual([[subject, { matchType: "extractor" }]])
    expect(() => $extract(() => result, subject)).toThrow(TypeError)
  }), { numRuns: 200 })
  expect(() => $extract({ [customMatcher]: () => true }, 1)).toThrow(TypeError)
})

test("custom-extractor-result-validation: false misses and iterable objects succeed", () => {
  fc.assert(fc.property(fc.array(fc.jsonValue()), values => {
    expect($extract({ [customMatcher]: () => false }, values)).toBe(false)
    expect($extract({ [customMatcher]: () => values }, 0)).toEqual(values)
    expect($extract({ [customMatcher]: () => new Set(values) }, 0)).toEqual([...new Set(values)])
    const iterableFunction = Object.assign(() => undefined, {
      *[Symbol.iterator]() { yield* values }
    })
    expect($extract({ [customMatcher]: () => iterableFunction }, 0)).toEqual(values)
  }), { numRuns: 100 })
})

test("custom-extractor-result-validation: abrupt calls and invalid objects stay abrupt", () => {
  const marker = new Error("matcher")
  expect(() => $extract({ [customMatcher]() { throw marker } }, 0)).toThrow(marker)
  for (const result of [{}, new Boolean(true), new Number(1)]) {
    expect(() => $extract({ [customMatcher]: () => result }, 0)).toThrow(TypeError)
  }
  const iterable = { get [Symbol.iterator](): any { throw marker } }
  expect(() => $extract({ [customMatcher]: () => iterable }, 0)).toThrow(marker)
})
