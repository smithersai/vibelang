import { expect, test } from "bun:test"
import fc from "fast-check"
import { $bindingReference, $readBinding, $uninitializedBinding } from "../src/match.js"

test("VIP-7: initialized values including undefined never mean TDZ", () => {
  const uninitialized = $uninitializedBinding()
  const values = fc.oneof(fc.anything(), fc.constant($uninitializedBinding), fc.constant($uninitializedBinding()))
  fc.assert(fc.property(values, value => {
    expect($readBinding(value, uninitialized)).toBe(value)
  }), { numRuns: 1000 })
  expect(() => $readBinding(uninitialized, uninitialized)).toThrow(ReferenceError)
  expect($readBinding($uninitializedBinding, uninitialized)).toBe($uninitializedBinding)
  const data = $uninitializedBinding()
  expect($readBinding(data, uninitialized)).toBe(data)
})

test("VIP-7: references retain TDZ and native write timing", () => {
  fc.assert(fc.property(fc.integer(), fc.boolean(), (value, constant) => {
    const uninitialized = $uninitializedBinding()
    let cell: unknown = uninitialized
    const ref = $bindingReference(() => cell, v => { cell = v }, constant, uninitialized)
    const trace: string[] = []
    expect(() => ref.value).toThrow(ReferenceError)
    expect(() => { ref.value = (trace.push("rhs"), value) }).toThrow(ReferenceError)
    expect(trace).toEqual(["rhs"])
    expect(cell).toBe(uninitialized)
    cell = undefined
    expect(ref.value).toBeUndefined()
    if (constant) {
      expect(() => { ref.value = value }).toThrow(TypeError)
      expect(cell).toBeUndefined()
    } else {
      expect(ref.value = value).toBe(value)
      expect(cell).toBe(value)
      expect(ref.value++).toBe(value)
      expect(cell).toBe(value + 1)
    }
  }), { numRuns: 500 })
})
