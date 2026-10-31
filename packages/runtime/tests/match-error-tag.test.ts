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

test("a family base matches its subclasses; a TypeScript subclass matches by instanceof", () => {
  class Base extends TaggedError("Base")<{ readonly code: string }> {}
  class Missing extends $errorSubclass(Base, "Missing") {}
  const missing = new Missing({ code: "m" })
  expect($is(Base, missing)).toBe(true)
  expect(($extract(Base, missing) as Array<unknown>)[0]).toBe(missing)
  expect($is(Missing, missing)).toBe(true)
  expect($is(Missing, new Base({ code: "b" }))).toBe(false)
  class Sub extends Base {}
  expect($is(Sub, new Sub({ code: "s" }))).toBe(true)
  expect($is(Sub, new Base({ code: "b" }))).toBe(false)
  expect($is(Sub, { _tag: "Base", code: "b" })).toBe(false)
})
