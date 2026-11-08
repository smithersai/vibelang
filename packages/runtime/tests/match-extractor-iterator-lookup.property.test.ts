import { expect, test } from "bun:test"
import fc from "fast-check"
import { $extract, customMatcher } from "../src/match"

// Chapter 004: "Native iterator acquisition, saved next, result-object checks,
// done/value reads and abrupt-completion handling are preserved."
// GetIterator reads Symbol.iterator directly; it never tests property presence.
function tracked(values: readonly number[], trace: string[], callable: boolean, throws: boolean) {
  const iterator = function* (this: unknown) {
    trace.push(this === proxy ? "receiver" : "wrong receiver")
    yield* values
  }
  const target = Object.assign(callable ? () => undefined : {}, { [Symbol.iterator]: iterator })
  const proxy = new Proxy(target, {
    has() {
      trace.push("has")
      if (throws) throw new Error("unexpected presence test")
      return false
    },
    get(target, key, receiver) {
      if (key === Symbol.iterator) trace.push("get")
      return Reflect.get(target, key, receiver)
    }
  })
  return proxy as Iterable<number>
}

test("extractor iterator lookup preserves native Get without a presence probe", () => {
  fc.assert(fc.property(fc.array(fc.integer(), { maxLength: 30 }), fc.boolean(), fc.boolean(), (values, callable, throws) => {
    for (const own of [false, true]) {
      const actualTrace: string[] = [], expectedTrace: string[] = []
      const actual = tracked(values, actualTrace, callable, throws)
      const expected = tracked(values, expectedTrace, callable, throws)
      const matcher = own ? { [customMatcher]: () => actual } : () => actual
      expect($extract(matcher, null)).toEqual(Array.from(expected))
      expect(actualTrace).toEqual(expectedTrace)
      expect(actualTrace).toEqual(["get", "receiver"])
    }
  }), { numRuns: 200 })
})

test("extractor iterator getter failures retain their identity", () => {
  fc.assert(fc.property(fc.integer(), marker => {
    for (const own of [false, true]) {
      const trace: string[] = []
      const result = new Proxy({}, {
        has() { trace.push("has"); return false },
        get(_target, key) { if (key === Symbol.iterator) { trace.push("get"); throw marker } }
      })
      const matcher = own ? { [customMatcher]: () => result } : () => result
      let caught: unknown = Symbol("not thrown")
      try { $extract(matcher, null) } catch (error) { caught = error }
      expect(caught).toBe(marker)
      expect(trace).toEqual(["get"])
    }
  }), { numRuns: 100 })
})

test("extractor invalid iterator methods throw after one Get", () => {
  for (const method of [undefined, null, false, 1, "iterator", {}]) {
    const trace: string[] = []
    const result = new Proxy({}, {
      has() { trace.push("has"); return true },
      get(_target, key) { if (key === Symbol.iterator) { trace.push("get"); return method } }
    })
    expect(() => $extract({ [customMatcher]: () => result }, null)).toThrow(TypeError)
    expect(trace).toEqual(["get"])
  }
})
