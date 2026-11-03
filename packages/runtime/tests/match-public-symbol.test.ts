import { expect, test } from "bun:test"
import fc from "fast-check"
import { $is, customMatcher } from "vibelang-runtime"

test("the public Symbol.customMatcher key is the runtime protocol key", () => {
  expect(Symbol.customMatcher).toBe(customMatcher)
})

test("matchers written with the public key dispatch once", () => {
  fc.assert(fc.property(fc.integer(), (value) => {
    let calls = 0
    const matcher = {
      [Symbol.customMatcher](subject: unknown) {
        calls++
        return subject === value
      }
    }
    expect($is(matcher, value)).toBe(true)
    expect(calls).toBe(1)
    expect($is(matcher, value + 1)).toBe(false)
    expect(calls).toBe(2)
  }))
})
