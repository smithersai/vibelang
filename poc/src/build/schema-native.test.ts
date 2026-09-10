import { describe, expect, test } from "bun:test"
import { deriveSchema, parseWithSchema, ValidationFailure } from "./schema.ts"

describe("native syntax-schema helper", () => {
  test("the first invalid property follows authored order, not Go map order", () => {
    const schema = deriveSchema("type T = { z: number; a: string; middle: boolean }", "T")
    expect(schema.kind).toBe("object")
    if (schema.kind !== "object") throw new Error("wrong schema")
    expect(Object.keys(schema.properties)).toEqual(["z", "a", "middle"])
    expect(Object.getPrototypeOf(schema.properties)).toBe(null)
    expect(() => parseWithSchema(schema, {})).toThrow("$input.z expected number")
    const value = parseWithSchema(schema, { middle: true, a: "data", z: 42 })
    expect(JSON.stringify(value)).toBe('{"z":42,"a":"data","middle":true}')
  })
  test("integer keys keep ordinary JavaScript enumeration semantics", () => {
    const schema = deriveSchema('type T = { "10": string; "2": number; z: boolean; "01": string }', "T")
    if (schema.kind !== "object") throw new Error("wrong schema")
    expect(Object.keys(schema.properties)).toEqual(["2", "10", "z", "01"])
  })
  test("escaped UTF16 keys and literal values cross the native wire losslessly", () => {
    const source = String.raw`type T = { "\ud800": "\udfff"; "😀": "\u0000"; "__proto__": "data"; "�": "replacement" }`
    const schema = deriveSchema(source, "T")
    if (schema.kind !== "object") throw new Error("wrong schema")
    expect(Object.keys(schema.properties)).toEqual(["\ud800", "😀", "__proto__", "�"])
    const value = JSON.parse('{"\\ud800":"\\udfff","😀":"\\u0000","__proto__":"data","�":"replacement"}')
    const decoded = parseWithSchema<Record<string, unknown>>(schema, value)
    expect(Object.getPrototypeOf(decoded)).toBe(null)
    expect(Object.hasOwn(decoded, "__proto__")).toBe(true)
    expect(decoded["\ud800"]).toBe("\udfff")
    expect(decoded["😀"]).toBe("\0")
    expect(decoded["�"]).toBe("replacement")
  })
  test("derived descriptor data is recursively frozen", () => {
    const schema = deriveSchema('type T = { field: [number, string[]] | null }', "T")
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== "object") return
      expect(Object.isFrozen(value)).toBe(true)
      for (const item of Object.values(value)) visit(item)
    }
    visit(schema)
    expect(() => parseWithSchema(schema, { field: [42, ["yes"]] })).not.toThrow()
  })
  for (const source of [
    "type X = number; interface T<X> { value: X }",
    "type T<Array> = Array<string>",
    'import type { Array } from "missing"; type T = Array<string>',
    'import { Other as Array } from "missing"; type T = Array<string>',
    "class Array<X> {}; type T = Array<string>",
  ]) test(`a lexical shadow cannot become the builtin or an unrelated type: ${source}`, () => {
    expect(() => deriveSchema(source, "T")).toThrow("cannot resolve")
  })
  test("escaped identifier references resolve to their real declaration", () => {
    expect(deriveSchema(String.raw`type Value = number; type T = \u0056alue`, "T")).toEqual({ kind: "number" })
  })
  test("parse failures remain SyntaxError, unsupported types remain ordinary Error", () => {
    expect(() => deriveSchema("type T = { a: }", "T")).toThrow(SyntaxError)
    try { deriveSchema("type T = any", "T"); throw new Error("expected refusal") } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(SyntaxError)
      expect(String(error)).toContain("does not support")
    }
  })
  test("literal mismatch retains the branded runtime validation failure", () => {
    const schema = deriveSchema('type T = "yes" | "no"', "T")
    expect(parseWithSchema<"yes" | "no">(schema, "yes")).toBe("yes")
    try { parseWithSchema(schema, "maybe"); throw new Error("expected validation failure") } catch (error) {
      expect(error).toBeInstanceOf(ValidationFailure)
      expect((error as ValidationFailure)._tag).toBe("ValidationFailure")
    }
  })
  test("schema derivation never invokes the source module", () => {
    expect(deriveSchema('globalThis.__notInvoked = (() => { throw new Error("must not run") })(); type T = number', "T"))
      .toEqual({ kind: "number" })
    expect(Object.hasOwn(globalThis, "__notInvoked")).toBe(false)
  })
})
