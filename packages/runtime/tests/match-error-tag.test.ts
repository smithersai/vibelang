import { expect, test } from "bun:test"
import { $extract, $is, $errorSubclass, TaggedError } from "../src/entry.js"

test("error matchers accept the same tag across copies", () => {
  class Bad extends TaggedError("Bad")<{ readonly id: string }> {}
  const copy = { _tag: "Bad", id: "x" }
  expect($is(Bad, copy)).toBe(true)
  expect($extract(Bad, copy)).toEqual([copy])
  expect(($extract(Bad, copy) as Array<unknown>)[0]).toBe(copy)
  for (const value of [null, undefined, 3, {}, { _tag: "Other" }]) {
    expect($is(Bad, value)).toBe(false)
    expect($extract(Bad, value)).toBe(false)
  }
  class Child extends $errorSubclass(Bad, "Child") {}
  expect($is(Child, { _tag: "Child", id: "x" })).toBe(true)
  expect($is(Child, copy)).toBe(false)
})
