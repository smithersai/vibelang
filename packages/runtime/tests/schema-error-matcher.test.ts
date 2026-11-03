import { expect, test } from "bun:test"
import { Schema } from "effect"
import { $extract, $is, customMatcher } from "../src/match.js"
import { $schemaErrorMatcher } from "../src/prelude.js"

test("schema error matchers retain tags and singleton extraction across copies and receivers", () => {
  class First extends Schema.TaggedError<First>()("Gone", { id: Schema.String }) {}
  class Copy extends Schema.TaggedError<Copy>()("Gone", { id: Schema.String }) {}
  $schemaErrorMatcher(First, "Gone")
  $schemaErrorMatcher(Copy, "Gone")
  const subjects = [new First({ id: "first" }), new Copy({ id: "copy" }),
    { _tag: "Gone" }, Object.assign(Object.create(null), { _tag: "Gone" }),
    Object.assign(() => 1, { _tag: "Gone" })]
  const proxy = new Proxy(First, {})
  const method = Reflect.get(First, customMatcher)
  expect(Object.hasOwn(First, customMatcher)).toBe(true)
  for (const subject of subjects) {
    expect($is(First, subject)).toBe(true)
    expect($is(Copy, subject)).toBe(true)
    expect($is(proxy, subject)).toBe(true)
    expect($extract(proxy, subject)).toEqual([subject])
    expect(method.call(function receiver() {}, subject)).toEqual([subject])
    expect($extract(First, subject)).toEqual([subject])
    expect(method(subject, { matchType: "boolean" })).toEqual([subject])
    expect(method.call({}, subject, { matchType: "extractor" })).toEqual([subject])
    expect(method(subject)[0]).toBe(subject)
  }
  for (const subject of [null, undefined, 1, "Gone", { _tag: "Other" }, {}]) {
    expect($is(First, subject)).toBe(false)
    expect($extract(First, subject)).toBe(false)
    expect(method(subject)).toBe(false)
  }
})

test("schema error matchers read the subject tag once and retain thrown getters", () => {
  class E extends Schema.TaggedError<E>()("E", {}) {}
  $schemaErrorMatcher(E, "E")
  const method = Reflect.get(E, customMatcher)
  let reads = 0
  const subject = { get _tag() { reads++; return "E" } }
  expect(method(subject)).toEqual([subject])
  expect(reads).toBe(1)
  const thrown = new Error("tag")
  expect(() => method({ get _tag() { throw thrown } })).toThrow(thrown)
})

test("schema error tag matching agrees with the literal tag oracle for generated subjects", async () => {
  const fc = await import("fast-check")
  fc.assert(fc.property(fc.string(), fc.anything(), (tag, value) => {
    class C {}
    $schemaErrorMatcher(C, tag)
    const proxy = new Proxy(C, {})
    const method = Reflect.get(C, customMatcher)
    for (const subject of [{ _tag: value }, Object.create({ _tag: value }),
      Object.assign(() => 1, { _tag: value })]) {
      const expected = value === tag
      expect($is(C, subject)).toBe(expected)
      expect($is(proxy, subject)).toBe(expected)
      expect($extract(proxy, subject)).toEqual(expected ? [subject] : false)
      expect($extract(C, subject)).toEqual(expected ? [subject] : false)
      expect(method(subject, { matchType: "boolean" })).toEqual(expected ? [subject] : false)
    }
    const positive = { _tag: tag }
    expect(($extract(C, positive) as [unknown])[0]).toBe(positive)
  }), { numRuns: 150 })
})

test("a native subclass keeps instance matching instead of inheriting tag matching", () => {
  class Parent extends Schema.TaggedError<Parent>()("Parent", { id: Schema.String }) {}
  $schemaErrorMatcher(Parent, "Parent")
  class Sub extends Parent {}
  const parent = new Parent({ id: "p" })
  const sub = new Sub({ id: "s" })
  expect($is(Parent, parent)).toBe(true)
  expect($is(Parent, { _tag: "Parent" })).toBe(true)
  expect($is(Sub, parent)).toBe(false)
  expect($is(Sub, { _tag: "Parent" })).toBe(false)
  expect($is(Sub, sub)).toBe(true)
  Object.defineProperty(Sub, customMatcher, { value: Reflect.get(Parent, customMatcher) })
  expect($is(Sub, { _tag: "Parent" })).toBe(true)
})
