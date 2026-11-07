import { expect, test } from "bun:test"
import { Schema } from "effect"
import { $extract, $is, customMatcher } from "../src/match.js"
import { $errorSubclass, $schemaErrorFamily, $schemaErrorMatcher, $schemaErrorMember, TaggedError } from "../src/prelude.js"

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
    class Child extends C {}
    const opaqueReceiver = new Proxy(Child, {
      getOwnPropertyDescriptor() { throw new Error("a matcher must not inspect its call receiver") },
      getPrototypeOf() { throw new Error("a matcher must not inspect its call receiver") }
    })
    for (const receiver of [undefined, null, {}, C, Child, opaqueReceiver]) {
      for (const matchType of ["boolean", "extractor"] as const) {
        const result = method.call(receiver, positive, { matchType })
        expect(result).toEqual([positive])
        expect(result[0]).toBe(positive)
      }
    }
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

// The class repairs write a legacy error family (D278) as native classes: a
// base whose tag type is widened, and subclasses tagged with their own names.
// The repairs must not change what the family matches (VIP-34).
class FamilyBase extends TaggedError("FamilyBase" as string)<{ readonly _tag: string; readonly message: string }> {
  static { $schemaErrorMatcher(this, "FamilyBase") }
}
class FamilyChild extends $errorSubclass(FamilyBase, "FamilyChild") {
  static { $schemaErrorMatcher(this, "FamilyChild", true) }
  declare readonly _tag: "FamilyChild"
}
class FamilySibling extends $errorSubclass(FamilyBase, "FamilySibling") {
  static { $schemaErrorMatcher(this, "FamilySibling", true) }
  declare readonly _tag: "FamilySibling"
}
class SchemaFamilyBase extends Schema.TaggedError<SchemaFamilyBase>()("SchemaFamilyBase" as string, { message: Schema.String }) {
  static {
    $schemaErrorMatcher(this, "SchemaFamilyBase")
    $schemaErrorFamily(this)
  }
}
class SchemaFamilyChild extends SchemaFamilyBase.extend<SchemaFamilyChild>("SchemaFamilyChild")({ _tag: Schema.tag("SchemaFamilyChild"), message: Schema.String }) {
  static {
    $schemaErrorMatcher(this, "SchemaFamilyChild")
    $schemaErrorMember(this)
  }
}
// The family's fields under another tag, in an unrelated class.
class SameShape extends TaggedError("SameShape")<{ readonly message: string }> {
  static { $schemaErrorMatcher(this, "SameShape", true) }
}

test("an error matcher accepts its subclasses' instances, whose own tags differ", () => {
  const cases: Array<[abstract new(...args: any) => unknown, unknown]> = [
    [FamilyBase, new FamilyChild({ message: "c" })],
    [FamilyBase, new FamilySibling({ message: "s" })],
    [SchemaFamilyBase, new SchemaFamilyChild({ message: "c" })]
  ]
  for (const [base, subject] of cases) {
    const method = Reflect.get(base, customMatcher)
    expect(subject instanceof base).toBe(true)
    expect($is(base, subject)).toBe(true)
    expect(($extract(base, subject) as [unknown])[0]).toBe(subject)
    expect(method.call(undefined, subject, { matchType: "boolean" })).toEqual([subject])
    expect(method.call({}, subject, { matchType: "extractor" })[0]).toBe(subject)
  }
})

test("an error matcher rejects a value neither tagged with its name nor its instance", () => {
  const rejected: Array<[abstract new(...args: any) => unknown, unknown]> = [
    // An unrelated error, and a plain object, with the family's fields.
    [FamilyBase, new SameShape({ message: "c" })],
    [FamilyBase, { _tag: "SameShape", message: "c" }],
    [SchemaFamilyBase, new SameShape({ message: "c" })],
    [SameShape, new FamilyChild({ message: "c" })],
    // Instances match upward only: neither a base nor a sibling is a child.
    [FamilyChild, new FamilyBase({ message: "b" })],
    [FamilyChild, new FamilySibling({ message: "s" })],
    [SchemaFamilyChild, new SchemaFamilyBase({ message: "b" })],
    // A copy of a subclass carries only its own tag, so a base does not claim it.
    [FamilyBase, { _tag: "FamilyChild", message: "c" }]
  ]
  for (const [error, subject] of rejected) {
    expect($is(error, subject)).toBe(false)
    expect($extract(error, subject)).toBe(false)
  }
  // VIP-13: a value tagged with the declaration's name still matches it.
  const copies: Array<[abstract new(...args: any) => unknown, unknown]> = [
    [FamilyBase, { _tag: "FamilyBase", message: "copy" }],
    [FamilyChild, { _tag: "FamilyChild", message: "copy" }],
    [SchemaFamilyBase, { _tag: "SchemaFamilyBase", message: "copy" }]
  ]
  for (const [error, subject] of copies) {
    expect($is(error, subject)).toBe(true)
    expect(($extract(error, subject) as [unknown])[0]).toBe(subject)
  }
})

test("generated error families match upward while retaining tag copies and receiver independence", async () => {
  const fc = await import("fast-check")
  fc.assert(fc.property(
    fc.uniqueArray(fc.string(), { minLength: 2, maxLength: 8 }),
    fc.nat(), fc.anything(),
    (tags, pick, payload) => {
      const family: Array<abstract new(...args: any) => unknown> = []
      let Parent = class {}
      for (const tag of tags) {
        const Base = Parent
        Parent = class extends Base {
          readonly _tag = tag
          readonly value = payload
        }
        $schemaErrorMatcher(Parent, tag)
        family.push(Parent)
      }
      const childIndex = pick % family.length
      const Child = family[childIndex]! as new() => unknown
      const subject = new Child()
      let tagReads = 0
      Object.defineProperty(subject, "_tag", { get() { tagReads++; return tags[childIndex] } })
      const unrelated = { _tag: tags[childIndex], value: payload }
      for (const [index, Pattern] of family.entries()) {
        const matcher = Reflect.get(Pattern, customMatcher)
        const expected = index <= childIndex
        tagReads = 0
        expect($is(Pattern, subject)).toBe(expected)
        expect(tagReads).toBe(1)
        expect($extract(Pattern, subject)).toEqual(expected ? [subject] : false)
        expect($is(Pattern, unrelated)).toBe(index === childIndex)
        for (const receiver of [undefined, null, {}, Child]) {
          const result = matcher.call(receiver, subject, { matchType: "extractor" })
          expect(result).toEqual(expected ? [subject] : false)
          if (result !== false) expect(result[0]).toBe(subject)
        }
      }
    }
  ), { numRuns: 150 })
})
