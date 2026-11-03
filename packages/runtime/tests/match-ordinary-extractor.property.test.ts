import { expect, test } from "bun:test"
import fc from "fast-check"
import { $extract, $is } from "../src/match"

// VIP-7 / 004-match.md: "For an ordinary class without an own matcher, the
// draft’s successful test returns `true`, not `[s]`: using it as an extractor
// throws `TypeError`, rather than binding an instance."
test("ordinary-class-extractor-runtime: recognition throws, rejection misses", () => {
  fc.assert(fc.property(fc.jsonValue(), fc.integer({ min: 0, max: 5 }), (payload, shape) => {
    class C { constructor(readonly value: unknown) {} }
    class Sub extends C {}
    const subject = [
      new C(payload), new Sub(payload), Object.create(C.prototype),
      Object.setPrototypeOf(new C(payload), null), payload, null
    ][shape]
    const recognized = subject instanceof C
    expect($is(C, subject)).toBe(recognized)
    if (recognized) expect(() => $extract(C, subject)).toThrow(TypeError)
    else expect($extract(C, subject)).toBe(false)
  }), { numRuns: 200 })
})

test("ordinary-class-extractor-runtime: ES5-style constructor and recognition order", () => {
  function C(this: any) {}
  C.prototype.method = () => 1
  expect(() => $extract(C as any, new (C as any)())).toThrow(TypeError)
  expect($extract(C as any, {})).toBe(false)
  const marker = new Error("instanceof")
  class Throws { static [Symbol.hasInstance](): boolean { throw marker } }
  expect(() => $extract(Throws, {})).toThrow(marker)
})

test("ordinary-class-extractor-runtime: built-in adapters keep their values", () => {
  for (const [ctor, value] of [
    [Map, new Map()], [Set, new Set()], [WeakMap, new WeakMap()],
    [WeakSet, new WeakSet()], [WeakRef, new WeakRef({})],
    [FinalizationRegistry, new FinalizationRegistry(() => {})],
    [Promise, Promise.resolve(1)], [RegExp, /x/], [Error, new Error()],
    [ArrayBuffer, new ArrayBuffer(2)], [DataView, new DataView(new ArrayBuffer(2))]
  ] as const) {
    expect($extract(ctor, value)).toEqual([value])
    expect($extract(ctor, null)).toBe(false)
  }
})
