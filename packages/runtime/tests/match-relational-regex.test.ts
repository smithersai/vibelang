import { expect, test } from "bun:test"
import fc from "fast-check"
import { $extract, $is, $relation, $relates } from "vibelang-runtime"

test("match: a regular expression matches as RegExp.prototype[Symbol.customMatcher] does", () => {
  expect($is(/^a+$/, "aaa")).toBe(true)
  expect($is(/^a+$/, "aab")).toBe(false)
  const extracted = $extract(/(?<id>\d+)-(\w)/, "12-x")
  expect(extracted && extracted.length).toBe(1)
  expect(extracted && extracted[0]![0]).toBe("12-x")
  expect(extracted && extracted[0]!.groups!.id).toBe("12")
  expect($extract(/z/, "abc")).toBe(false)
  const all = $extract(/\d/g, "a1b2")
  expect(all && all.map(m => m[0])).toEqual(["1", "2"])
  expect($extract(/\d/g, "ab")).toBe(false)
  expect($is(RegExp, /x/)).toBe(true)
  expect($is(RegExp, "x")).toBe(false)
})

test("match: a relation compares only a string, a number or a bigint", () => {
  expect($relation("<", 1, 2)).toBe(true)
  expect($relation("<=", 2, 2)).toBe(true)
  expect($relation(">=", 1, 2)).toBe(false)
  expect($relation(">", "b", "a")).toBe(true)
  expect($relation("<", 1n, 2)).toBe(true)
  // A non-comparable subject fails before the bound coerces.
  let read = 0
  const bound = { valueOf() { read++; return 1 } }
  expect($relation("<", null, bound)).toBe(false)
  expect($relation("<", {}, bound)).toBe(false)
  expect(read).toBe(0)
  // NaN compares false on both sides.
  expect($relation("<=", NaN, 1)).toBe(false)
  expect($relation(">=", NaN, 1)).toBe(false)
})

test("match: in tests a property key against an object", () => {
  expect($relation("in", "a", { a: 1 })).toBe(true)
  expect($relation("in", "b", { a: 1 })).toBe(false)
  expect($relation("in", 1, { 1: 1 })).toBe(false)
  expect($relation("in", "a", null)).toBe(false)
})

test("match: a relation admits its subject by type alone, before its operand runs", () => {
  for (const operator of ["<", ">", "<=", ">="] as const) {
    expect([1, "a", 1n, NaN].map(s => $relates(operator, s))).toEqual([true, true, true, true])
    expect([{}, null, undefined, true, Symbol("s"), new Number(1)].map(s => $relates(operator, s))).toEqual([false, false, false, false, false, false])
  }
  expect(["a", Symbol("s")].map(s => $relates("in", s))).toEqual([true, true])
  expect([1, {}, null, new String("a")].map(s => $relates("in", s))).toEqual([false, false, false, false])
})

test("match: $relation is false for every subject $relates rejects", () => {
  const operators = fc.constantFrom("<" as const, ">" as const, "<=" as const, ">=" as const, "in" as const)
  fc.assert(fc.property(operators, fc.anything(), fc.anything(), (operator, subject, value) => {
    const admitted = operator === "in"
      ? typeof subject === "string" || typeof subject === "symbol"
      : typeof subject === "string" || typeof subject === "number" || typeof subject === "bigint"
    expect($relates(operator, subject)).toBe(admitted)
    if (!admitted) expect($relation(operator, subject, value)).toBe(false)
  }), { numRuns: 500 })
})
