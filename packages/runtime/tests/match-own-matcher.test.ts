import { expect, test } from "bun:test"
import { $extract, $is, customMatcher, TaggedError } from "vibelang-runtime"

class Base {
  static [customMatcher](s: unknown) { return s === "inherited" }
}
class Derived extends Base {}

test("match: a class uses its own matcher, not one a superclass declares", () => {
  expect($is(Base, "inherited")).toBe(true)
  expect($is(Derived, "inherited")).toBe(false)
  expect($is(Derived, new Derived())).toBe(true)
  expect($is(Derived, new Base())).toBe(false)
})

test("match: an own matcher on a subclass decides, and an object's matcher is its own", () => {
  class Own extends Base {
    static override [customMatcher](s: unknown) { return s === "own" }
  }
  expect($is(Own, "own")).toBe(true)
  expect($is(Own, "inherited")).toBe(false)
  const object = { [customMatcher](s: unknown) { return s === 1 ? [s] : false } }
  expect($extract(object, 1)).toEqual([1])
})

test("match: an error family keeps its generated matcher in every subclass", () => {
  class NotFound extends TaggedError("NotFound")<{ readonly id: string }> {}
  expect($is(NotFound, { _tag: "NotFound" })).toBe(true)
  expect($is(NotFound, { _tag: "Other" })).toBe(false)
  expect($extract(NotFound, new NotFound({ id: "1" }))).toHaveLength(1)
})
