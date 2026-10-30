import { expect, test } from "bun:test"
import { $assertMatch, $extract, $is, $noMatch, $patternError, $rest, customMatcher, TaggedError } from "vibelang-runtime"

class NotFound extends TaggedError("NotFound")<{ readonly id: string }> {}
class Timeout extends TaggedError("Timeout")<{}> {}

test("match: $is tests classes, predicates, primitives, custom matchers, and values", () => {
  expect($is(NotFound, new NotFound({ id: "1" }))).toBe(true)
  expect($is(NotFound, new Timeout())).toBe(false)
  expect($is(Date, new Date())).toBe(true)
  expect($is(String, "a")).toBe(true)
  expect($is(Number, "a")).toBe(false)
  expect($is((x: unknown) => x === 3, 3)).toBe(true)
  const even = { [customMatcher]: (x: unknown) => typeof x === "number" && x % 2 === 0 }
  expect($is(even, 4)).toBe(true)
  expect($is(even, 5)).toBe(false)
  expect($is(NaN, NaN)).toBe(true)
  expect($is(0, -0)).toBe(true)
  expect($is("a", "a")).toBe(true)
})

test("match: tagged errors carry the proposal's custom matcher", () => {
  const error = new NotFound({ id: "7" })
  expect((NotFound as any)[customMatcher](error, { matchType: "boolean" })).toBe(true)
  expect((NotFound as any)[customMatcher](new Timeout(), { matchType: "boolean" })).toBe(false)
  expect($extract(NotFound, error)).toEqual([error])
  expect($extract(NotFound, new Timeout())).toBe(false)
})

test("match: $extract follows a custom matcher's result", () => {
  const pair = { [customMatcher]: (x: unknown) => (Array.isArray(x) && x.length === 2 ? x : false) }
  expect($extract(pair, [1, 2])).toEqual([1, 2])
  expect($extract(pair, [1])).toBe(false)
  const always = { [customMatcher]: () => true }
  expect($extract(always, 1)).toEqual([])
  const set = { [customMatcher]: () => new Set([1, 2]) }
  expect($extract(set, 1)).toEqual([1, 2])
  expect($extract(String, "s")).toEqual(["s"])
  expect(() => $extract(3, 1)).toThrow(TypeError)
})

test("match: $rest keeps the properties the clauses do not name; $noMatch and $patternError throw", () => {
  expect($rest({ a: 1, b: 2, c: 3 }, ["a"])).toEqual({ b: 2, c: 3 })
  expect(() => $noMatch({ _tag: "Timeout" })).toThrow(TypeError)
  expect(() => $patternError(4705)).toThrow(TypeError)
})

test("match: $assertMatch returns when the last arm's test passed and throws $noMatch's TypeError when it failed", () => {
  expect($assertMatch(true, "kept")).toBeUndefined()
  expect($assertMatch(1, "kept")).toBeUndefined()
  expect(() => $assertMatch(false, "missing")).toThrow('No match arm matched "missing"')
  const structural = { _tag: "NotFound", id: "1" }
  expect($assertMatch($is(NotFound, structural), structural)).toBeUndefined()
  expect($assertMatch($is(NotFound, new NotFound({ id: "1" })), structural)).toBeUndefined()
})

test("match: object rest copies __proto__ as data without changing the result prototype", () => {
  const subject = JSON.parse('{"__proto__":{"inherited":true},"value":42}')
  const rest = $rest(subject, [])
  expect(Object.getPrototypeOf(rest)).toBe(Object.prototype)
  expect(Object.hasOwn(rest, "__proto__")).toBe(true)
  expect(rest.__proto__).toEqual({ inherited: true })
  expect((rest as any).inherited).toBeUndefined()
  expect(rest.value).toBe(42)
})

test("match: generated object rests agree with JavaScript destructuring for string and symbol keys", () => {
  const excluded = Symbol("excluded")
  const retained = Symbol("retained")
  const keys = ["exclude", "__proto__", "constructor", "toString", "0", "100", "日本語", retained, excluded]
  for (let trial = 0; trial < 40; trial++) {
    const subject = Object.create({ inherited: "must not copy" })
    for (const [index, key] of keys.entries()) {
      Object.defineProperty(subject, key, { value: trial * 13 + index, enumerable: (trial + index) % 3 !== 0 })
    }
    const { exclude: _first, [excluded]: _second, ...expected } = subject
    const actual = $rest(subject, ["exclude", excluded])
    expect(Reflect.ownKeys(actual)).toEqual(Reflect.ownKeys(expected))
    expect(Object.getOwnPropertyDescriptors(actual)).toEqual(Object.getOwnPropertyDescriptors(expected))
    expect(Object.getPrototypeOf(actual)).toBe(Object.prototype)
  }
})

test("match: object rest reads only included enumerable getters, once in property order", () => {
  const reads: string[] = []
  const subject = Object.defineProperties({}, {
    excluded: { enumerable: true, get() { throw new Error("must not read") } },
    hidden: { get() { throw new Error("must not read") } },
    first: { enumerable: true, get() { reads.push("first"); return 1 } },
    second: { enumerable: true, get() { reads.push("second"); return 2 } }
  })
  expect($rest(subject, ["excluded"])).toEqual({ first: 1, second: 2 })
  expect(reads).toEqual(["first", "second"])
})

test("match: computed numeric rest exclusions use JavaScript property-key coercion", () => {
  const subject = { "0": "zero", "42": "answer", "1.5": "fraction", NaN: "nan", Infinity: "infinity", keep: true }
  for (const key of [0, -0, 42, 1.5, NaN, Infinity]) {
    const { [key]: _excluded, ...expected } = subject as Record<string, unknown>
    expect($rest(subject, [key])).toEqual(expected)
  }
})

test("match: a custom matcher sees its receiver and the boolean or extractor hint", () => {
  const calls: unknown[] = []
  const matcher = {
    [customMatcher](subject: unknown, hint: unknown) {
      expect(this).toBe(matcher)
      calls.push([subject, hint])
      return new Set([subject])
    }
  }
  expect($is(matcher, 42)).toBe(true)
  expect($extract(matcher, 42)).toEqual([42])
  expect(calls).toEqual([[42, { matchType: "boolean" }], [42, { matchType: "extractor" }]])
  for (const result of [null, undefined, 1, "invalid"]) {
    expect(() => $extract({ [customMatcher]: () => result }, 42)).toThrow("must return true, false, an array, or an iterable")
  }
})

test("match: class extraction, primitive mismatches, and unprintable unmatched values", () => {
  class Box {}
  const box = new Box()
  expect($extract(Box, box)).toEqual([box])
  expect($extract(Box, {})).toBe(false)
  expect($extract(Number, "42")).toBe(false)
  expect($extract(Symbol, Symbol.for("key"))).toEqual([Symbol.for("key")])
  expect(() => $extract(undefined, 42)).toThrow(TypeError)
  expect(() => $noMatch("missing")).toThrow('No match arm matched "missing"')
  expect(() => $noMatch({ [Symbol.toPrimitive]() { throw new Error("cannot print") } })).toThrow("No match arm matched object")
})
