import { expect, test } from "bun:test"
import fc from "fast-check"
import { $extract, $is, customMatcher } from "../src/match.js"

const generatedIs = $is as (...args: unknown[]) => unknown
const generatedExtract = $extract as (...args: unknown[]) => unknown
function capture(f: () => unknown): unknown {
  try { return ["value", f()] }
  catch (error) { return ["throw", (error as Error).name, (error as Error).message] }
}

test("generated matcher lookup preserves every own protocol value", () => {
  const values = fc.oneof(fc.constant(undefined), fc.constant(null), fc.boolean(), fc.integer(), fc.string(), fc.array(fc.integer()), fc.dictionary(fc.string(), fc.integer()))
  try {
  fc.assert(fc.property(values, fc.integer({ min: 1, max: 5 }), fc.boolean(), (value, repeats, object) => {
    class C {}
    const matcher = object ? {} : C
    let reads = 0
    Object.defineProperty(matcher, customMatcher, { configurable: true, get() { reads++; return value } })
    for (let i = 0; i < repeats; i++) {
      for (const subject of [object ? matcher : new C(), matcher, {}]) {
        for (const [hint, run] of [
          ["boolean", generatedIs],
          ["extractor", generatedExtract]
        ] as const) {
          reads = 0
          const actual = capture(() => run(matcher, subject, null, true))
          expect(reads).toBe(1)
          reads = 0
          const native = capture(() => {
            const method = Reflect.get(matcher, customMatcher)
            if (method === undefined) {
              if (hint === "extractor") throw new TypeError()
              return subject === matcher
            }
            return Reflect.apply(method, matcher, [subject, { matchType: hint }, null])
          })
          expect(reads).toBe(1)
          expect(actual).toEqual(native)
        }
      }
    }
    // Direct runtime calls retain their established helper compatibility.
    expect($is(matcher, object ? matcher : new C())).toBe(true)
  }), { numRuns: 100 })
  } catch (error) {
    const failure = error as Error & { cause?: unknown }
    throw new Error(failure.message + "\n" + String(failure.cause), { cause: failure })
  }
})

test("own undefined and an absent class matcher keep distinct defaults", () => {
  class C {}
  Object.defineProperty(C, customMatcher, { value: undefined, configurable: true })
  expect(generatedIs(C, new C(), null, true)).toBe(false)
  expect(generatedIs(C, C, null, true)).toBe(true)
  expect(() => generatedExtract(C, {}, null, true)).toThrow(TypeError)
  expect(() => generatedExtract(C, new C(), null, true)).toThrow(TypeError)
  Reflect.deleteProperty(C, customMatcher)
  expect(generatedIs(C, new C(), null, true)).toBe(true)
  expect(generatedIs(C, C, null, true)).toBe(false)
})
