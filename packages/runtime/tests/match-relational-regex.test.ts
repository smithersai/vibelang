import { expect, test } from "bun:test"
import { $extract, $is, $relation } from "vibelang-runtime"

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
