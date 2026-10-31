import { expect, test } from "bun:test"
import fc from "fast-check"
import { $extract, $is } from "vibelang-runtime"

// Chapter 004, Class patterns: Array and the typed arrays list the subject
// itself, as the draft's Array and TypedArray matchers do; Map and the other
// built-ins extract [subject]; a function that is no class is called with the
// subject and the extractor hint, and its false or iterable result is the list.

test("match: Array extracts an array's elements and rejects everything else", () => {
  fc.assert(fc.property(fc.array(fc.anything()), xs => {
    const extracted = $extract(Array, xs)
    expect(extracted).not.toBe(false)
    expect([...(extracted as ReadonlyArray<unknown>)]).toEqual(xs)
  }))
  fc.assert(fc.property(fc.anything().filter(x => !Array.isArray(x)), x => {
    expect($extract(Array, x)).toBe(false)
  }))
})

test("match: a typed array extracts its own kind's elements only", () => {
  fc.assert(fc.property(fc.uint8Array(), bytes => {
    expect([...($extract(Uint8Array, bytes) as Uint8Array)]).toEqual([...bytes])
    expect($extract(Int16Array, bytes)).toBe(false)
    expect($extract(Uint8Array, [...bytes])).toBe(false)
  }))
})

test("match: Map and Set extract the collection itself", () => {
  const map = new Map([[1, 2]])
  const set = new Set([1])
  expect($extract(Map, map)).toEqual([map])
  expect($extract(Set, set)).toEqual([set])
  expect($extract(Map, set)).toBe(false)
})

test("match: a call-only extractor is called with the subject and the extractor hint", () => {
  fc.assert(fc.property(fc.anything(), fc.oneof(fc.constant(false as const), fc.array(fc.anything())), (subject, result) => {
    const calls: Array<ReadonlyArray<unknown>> = []
    const extractor = (s: unknown, hint: { readonly matchType: string }) => {
      calls.push([s, hint])
      return result
    }
    expect($extract(extractor, subject)).toEqual(result)
    expect(calls).toEqual([[subject, { matchType: "extractor" }]])
  }))
  function* two() { yield 1; yield 2 }
  expect($extract(() => two(), 0)).toEqual([1, 2])
  expect(() => $extract(() => 3, 0)).toThrow(TypeError)
})

test("match: a predicate receives the boolean hint", () => {
  const hints: Array<unknown> = []
  expect($is((s: unknown, hint: unknown) => (hints.push(hint), s === 1), 1)).toBe(true)
  expect(hints).toEqual([{ matchType: "boolean" }])
})
