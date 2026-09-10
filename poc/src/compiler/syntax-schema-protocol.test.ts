import { describe, expect, test } from "bun:test"
import { decodeNativeSyntaxSchema, NATIVE_API_VERSION } from "./protocol.ts"

const revision = "a".repeat(40)
const wire = (schema: unknown = { kind: "number" }) => ({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision,
  result: { ok: true, schemaJson: JSON.stringify(schema), message: "", parseError: false } })
const decode = (value: unknown) => decodeNativeSyntaxSchema(JSON.stringify(value), revision)

describe("native syntax-schema protocol", () => {
  test("success carries only a validated data grammar", () => {
    const value = wire({ kind: "object", properties: { first: { optional: false, schema: { kind: "tuple", elements: [] } } } })
    expect<unknown>(decode(value)).toEqual(value.result)
  })
  test("escaped lone surrogates are data, not invalid scalar source text", () => {
    const value = wire({ kind: "object", properties: { ["\ud800"]: { optional: false, schema: { kind: "literal", value: "\udfff" } } } })
    expect(JSON.parse(decode(value).schemaJson).properties["\ud800"].schema.value).toBe("\udfff")
  })
  test("parse and unsupported-type failures are distinct and carry no schema", () => {
    for (const parseError of [false, true]) {
      const value = wire(); value.result = { ok: false, schemaJson: "", message: "reason", parseError }
      expect(decode(value).parseError).toBe(parseError)
    }
  })
  for (const [name, schema] of [
    ["unknown kind", { kind: "any" }], ["null", null], ["array root", []],
    ["extra primitive field", { kind: "number", value: 1 }], ["missing literal", { kind: "literal" }],
    ["null literal", { kind: "literal", value: null }], ["object literal", { kind: "literal", value: {} }],
    ["missing element", { kind: "array" }], ["extra array field", { kind: "array", element: {kind:"number"}, value:1 }],
    ["non-array tuple", { kind: "tuple", elements: {} }], ["singleton union", { kind: "union", variants: [{kind:"number"}] }],
    ["empty union", { kind: "union", variants: [] }], ["array properties", { kind: "object", properties: [] }],
    ["null properties", { kind: "object", properties: null }], ["missing optional flag", { kind: "object", properties: { x: {schema:{kind:"number"}} } }],
    ["nonboolean optional", { kind: "object", properties: {x:{optional:1,schema:{kind:"number"}}} }],
    ["unknown field property", { kind: "object", properties: {x:{optional:false,schema:{kind:"number"}, extra:true}} }],
  ] as const) test(`rejects ${name}`, () => { expect(() => decode(wire(schema))).toThrow() })
  for (const [name, mutate] of [
    ["partial failure", (v:any) => { v.result.ok = false; v.result.message = "reason" }],
    ["success with message", (v:any) => { v.result.message = "reason" }],
    ["successful parse error", (v:any) => { v.result.parseError = true }],
    ["missing success schema", (v:any) => { v.result.schemaJson = "" }],
    ["invalid data JSON", (v:any) => { v.result.schemaJson = "undefined" }],
    ["non-finite data number", (v:any) => { v.result.schemaJson = '{"kind":"literal","value":1e400}' }],
    ["negative zero", (v:any) => { v.result.schemaJson = '{"kind":"literal","value":-0}' }],
    ["schema byte budget", (v:any) => { v.result.schemaJson = " ".repeat(16*1024*1024+1) }],
    ["extra result field", (v:any) => { v.result.source = "changed" }],
  ] as const) test(`rejects ${name}`, () => { const value = wire(); mutate(value); expect(() => decode(value)).toThrow() })
  test("descriptor expansion is bounded", () => {
    expect(() => decode(wire({ kind: "tuple", elements: Array.from({length:10000}, () => ({kind:"number"})) }))).toThrow()
    let schema: unknown = { kind: "number" }
    for (let index = 0; index < 129; index++) schema = { kind: "array", element: schema }
    expect(() => decode(wire(schema))).toThrow()
  })
})
