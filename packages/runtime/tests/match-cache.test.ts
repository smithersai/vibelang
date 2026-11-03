import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { $matchCache } from "../src/match-cache.js"

describe("VIP-7 cached iterable patterns", () => {
  test("different arm prefixes share acquisition, saved next and pulled values", () => {
    fc.assert(fc.property(fc.array(fc.integer(), { maxLength: 30 }), fc.nat(30), (values, prefix) => {
      let acquisitions = 0, nextReads = 0, pulls = 0
      const subject = {
        [Symbol.iterator]() {
          acquisitions++
          let index = 0
          return { get next() { nextReads++; return () => { pulls++; return index < values.length ? { done: false, value: values[index++] } : { done: true } } } }
        }
      }
      const cache = $matchCache()
      expect(cache.iterable(subject)).toBe(true)
      for (let i = 0; i < Math.min(prefix, values.length); i++) {
        expect(cache.has(subject, i)).toBe(true)
        expect(cache.at(subject, i)).toBe(values[i])
      }
      expect(cache.iterable(subject)).toBe(true)
      expect(cache.rest(subject, 0)).toEqual(values)
      cache.finish()
      expect([acquisitions, nextReads, pulls]).toEqual([1, 1, values.length + 1])
    }), { numRuns: 150 })
  })
  test("native GetV uses a primitive subject as receiver", () => {
    const descriptor = Object.getOwnPropertyDescriptor(String.prototype, Symbol.iterator)!
    const seen: unknown[] = []
    try {
      Object.defineProperty(String.prototype, Symbol.iterator, { configurable: true, get() {
        "use strict"
        seen.push(this)
        return function(this: unknown) { seen.push(this); return Reflect.apply(descriptor.value, this, []) }
      } })
      const cache = $matchCache()
      expect(cache.iterable("ab")).toBe(true)
      expect(cache.rest("ab", 0)).toEqual(["a","b"])
      cache.finish()
      expect(seen).toEqual(["ab","ab"])
    } finally { Object.defineProperty(String.prototype, Symbol.iterator, descriptor) }
  })
  test("native throws and close failures retain identity and insertion order", () => {
    const trace: number[] = [], body = {}, one = {}, two = {}
    const subject = (id: number, failure: unknown) => ({
      [Symbol.iterator]() { return { next() { return { value: 1, done: false } }, return() { trace.push(id); throw failure } } }
    })
    const a = subject(1, one), b = subject(2, two), cache = $matchCache()
    cache.iterable(a); cache.iterable(b); cache.threw(body)
    try { cache.finish(); throw new Error("must throw") }
    catch (error) { expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors).toEqual([body, one, two]) }
    expect(trace).toEqual([1,2])
    cache.finish()
  })
  test("iteration errors mark the record done without closing it", () => {
    for (const mode of ["next", "result", "done", "value"]) {
      let closes = 0
      const failure = {}
      const subject = { [Symbol.iterator]() { return {
        next() {
          if (mode === "next") throw failure
          if (mode === "result") return null
          return { get done() { if (mode === "done") throw failure; return false }, get value() { throw failure } }
        },
        return() { closes++; return {} }
      } } }
      const cache = $matchCache()
      cache.iterable(subject)
      expect(() => cache.has(subject, 0)).toThrow()
      cache.finish()
      expect(closes).toBe(0)
    }
  })
  test("bookkeeping never probes user properties with internal record names", () => {
    const subject = { [Symbol.iterator]() { return { next() { return { value: 2 } }, return() { return {} } } },
      get Value() { throw new Error("private") }, get IteratorsToClose() { throw new Error("private") } }
    const cache = $matchCache()
    expect(cache.iterable(subject)).toBe(true)
    expect(cache.has(subject, 0)).toBe(true)
    expect(cache.at(subject, 0)).toBe(2)
    cache.finish()
  })
})
