import { expect, test } from "bun:test"
import fc from "fast-check"
import { runInNewContext } from "node:vm"
import { $extract, $is } from "../src/match"

// Chapter 004: primitive patterns accept the primitive or its native wrapper,
// extracting the primitive directly and a wrapper through its valueOf().
const constructors = [String, Number, Boolean, BigInt, Symbol] as const
const values = fc.oneof(fc.string(), fc.double(), fc.boolean(), fc.bigInt(), fc.string().map(Symbol.for))

test("primitive matchers accept and unbox all native wrapper types", () => {
  fc.assert(fc.property(values, value => {
    const matching = constructors.find(C => typeof value === C.name.toLowerCase())!
    for (const C of constructors) {
      for (const subject of [value, Object(value)]) {
        const matches = C === matching
        expect($is(C, subject)).toBe(matches)
        const extracted = $extract(C, subject)
        if (!matches) expect(extracted).toBe(false)
        else {
          expect(extracted).not.toBe(false)
          expect(Object.is((extracted as readonly unknown[])[0], value)).toBe(true)
        }
      }
    }
  }), { numRuns: 150, seed: 70087 })
})

test("only boxed extraction reads and calls valueOf, with the wrapper receiver", () => {
  for (const [C, value] of [[String, "x"], [Number, -0], [Boolean, false], [BigInt, 3n], [Symbol, Symbol.for("x")]] as const) {
    const trace: string[] = []
    const box = Object(value)
    Object.defineProperty(box, "valueOf", { get() {
      trace.push("get")
      return function(this: unknown) {
        expect(this).toBe(box)
        trace.push("call")
        return value
      }
    } })
    expect($is(C, box)).toBe(true)
    expect(trace).toEqual([])
    expect(Object.is(($extract(C, box) as readonly unknown[])[0], value)).toBe(true)
    expect(trace).toEqual(["get", "call"])
    const original = Object.getOwnPropertyDescriptor(C.prototype, "valueOf")!
    try {
      Object.defineProperty(C.prototype, "valueOf", { configurable: true, value() { trace.push("primitive"); return "wrong" } })
      expect(Object.is(($extract(C, value) as readonly unknown[])[0], value)).toBe(true)
    } finally { Object.defineProperty(C.prototype, "valueOf", original) }
    expect(trace).toEqual(["get", "call"])
  }
})

test("boxed matching follows instanceof including subclasses, foreign realms and forged prototypes", () => {
  class Text extends String {}
  expect($extract(String, new Text("x"))).toEqual(["x"])
  const foreign = runInNewContext("[new String('x'),new Number(2),new Boolean(false),Object(3n),Object(Symbol.for('x'))]")
  for (const C of constructors) {
    for (const box of foreign) {
      expect($is(C, box)).toBe(false)
      expect($extract(C, box)).toBe(false)
    }
    const forged = Object.create(C.prototype)
    expect($is(C, forged)).toBe(true)
    expect(() => $extract(C, forged)).toThrow(TypeError)
    expect($extract(C, null)).toBe(false)
    expect($extract(C, {})).toBe(false)
  }
})
