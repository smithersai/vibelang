import { describe, expect, test } from "bun:test"
import { decodeNativeInspection, NATIVE_API_VERSION } from "./protocol.ts"

const revision = "a".repeat(40)
const sources = [{ path: "config.json", text: '{"x":1,"x":2}', scriptKind: "json" as const }]
const wire = () => ({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result: { files: [{
  path: "config.json", diagnostics: [] as unknown[], moduleSyntax: [] as unknown[], jsonDuplicateKeys: [{start:7,length:3}],
}] } })
const decode = (value: unknown) => decodeNativeInspection(JSON.stringify(value), revision, sources)

describe("native JSON/config inspection protocol", () => {
  test("returns native key-token spans, never decoded/repaired keys", () => {
    expect<unknown>(decode(wire())).toEqual(wire().result)
  })
  test("an empty key list is distinct from omitted JSON inspection", () => {
    const value = wire()
    value.result.files[0]!.jsonDuplicateKeys = []
    expect(decode(value).files[0]!.jsonDuplicateKeys).toEqual([])
  })
  test("other script kinds cannot claim JSON key facts", () => {
    expect(() => decodeNativeInspection(JSON.stringify(wire()), revision, [{ ...sources[0]!, scriptKind: "typescript" }])).toThrow()
  })
  for (const [name, mutate] of [
    ["missing key facts", (w:any) => { delete w.result.files[0].jsonDuplicateKeys }],
    ["null key facts", (w:any) => { w.result.files[0].jsonDuplicateKeys = null }],
    ["module syntax in data", (w:any) => { w.result.files[0].moduleSyntax = [{kind:"dynamic-import",topLevel:false,span:{start:0,length:1}}] }],
    ["decoded key field", (w:any) => { w.result.files[0].jsonDuplicateKeys[0].key = "x" }],
    ["negative position", (w:any) => { w.result.files[0].jsonDuplicateKeys[0].start = -1 }],
    ["fractional position", (w:any) => { w.result.files[0].jsonDuplicateKeys[0].start = 0.5 }],
    ["empty token", (w:any) => { w.result.files[0].jsonDuplicateKeys[0].length = 0 }],
    ["short token", (w:any) => { w.result.files[0].jsonDuplicateKeys[0].length = 1 }],
    ["out of source", (w:any) => { w.result.files[0].jsonDuplicateKeys[0].length = 100 }],
    ["repeated token", (w:any) => { w.result.files[0].jsonDuplicateKeys.push(w.result.files[0].jsonDuplicateKeys[0]) }],
  ] as const) test(`rejects ${name}`, () => { const value = wire(); mutate(value); expect(() => decode(value)).toThrow() })
})
