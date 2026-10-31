import { expect, test } from "bun:test"
import fc from "fast-check"
import { runInNewContext } from "node:vm"
import { $is } from "vibelang-runtime"

// Chapter 004, decided detail 67a:
// "Built-in constructor patterns use `Array.isArray(subject)` for `Array`, and `subject instanceof C` for every other built-in, including native errors, `AggregateError`, `Date`, `RegExp`, collections, `Promise`, typed arrays and `ArrayBuffer` (decided detail 67a)."
// Bug key: 004:date-pattern-internal-slot. Compare the stated native
// counterpart, including changed prototypes, proxies and abrupt completion.
const subjects: readonly [string, (n: number) => unknown][] = [
  ["genuine", n => new Date(n)],
  ["invalid", () => new Date(NaN)],
  ["forged", () => Object.create(Date.prototype)],
  ["reparented", n => Object.setPrototypeOf(new Date(n), Object.prototype)],
  ["foreign", n => runInNewContext("new Date(" + n + ")")],
  ["proxy", n => new Proxy(new Date(n), {})],
  ["tagged object", n => ({ value: n, [Symbol.toStringTag]: "Date" })],
]
for (const [name, make] of subjects) {
  test("Date pattern uses the native prototype test: " + name, () => {
    fc.assert(fc.property(fc.integer(), n => {
      const subject = make(n)
      expect($is(Date, subject)).toBe(subject instanceof Date)
    }), { numRuns: 50 })
  })
}

test("Date pattern preserves abrupt prototype lookup", () => {
  fc.assert(fc.property(fc.string(), message => {
    const failure = new Error(message)
    let calls = 0
    const subject = new Proxy({}, { getPrototypeOf() { calls++; throw failure } })
    let observed: unknown
    try { $is(Date, subject) } catch (error) { observed = error }
    expect(observed).toBe(failure)
    expect(calls).toBe(1)
  }), { numRuns: 50 })
})
