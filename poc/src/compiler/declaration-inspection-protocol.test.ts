import { expect, test } from "bun:test"
import { decodeNativeInspection, NATIVE_API_VERSION } from "./protocol.ts"

const revision = "a".repeat(40)
const source = { path: "declarations.ts", text: "const value = 1; function read() { return value }", scriptKind: "typescript" as const, declarationBindings: true }
const wire = () => ({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result: { files: [{
  path: source.path, diagnostics: [] as unknown[], moduleSyntax: [], declarationBindings: [
    { kind: "variable", name: "value", span: { start: 6, length: 9 }, nameSpan: { start: 6, length: 5 } },
    { kind: "function", name: "read", span: { start: 17, length: 32 }, nameSpan: { start: 26, length: 4 } },
  ],
}] } })
const decode = (value: unknown, input = source) => decodeNativeInspection(JSON.stringify(value), revision, [input])

test("native declaration inventories preserve private variable and function syntax", () => {
  const value = wire()
  value.result.files[0]!.declarationBindings[1]!.span.length = source.text.length - 17
  expect<unknown>(decode(value)).toEqual(value.result)
})

test("declaration inventories are opt-in, not inferred from returned fields", () => {
  const value = wire()
  expect(() => decode(value, { ...source, declarationBindings: false })).toThrow()
  delete (value.result.files[0] as any).declarationBindings
  expect(decode(value, { ...source, declarationBindings: false }).files[0]!.declarationBindings).toBeUndefined()
})

test("a parser refusal cannot claim a recovered inventory", () => {
  const value = wire()
  value.result.files[0]!.diagnostics = [{ code: "TS1000", category: "error", message: "invalid syntax", file: source.path, phase: "parse", span: { start: 0, length: 1 } }]
  expect(() => decode(value)).toThrow()
  value.result.files[0]!.declarationBindings = []
  expect(decode(value).files[0]!.declarationBindings).toEqual([])
})

test("patterns and anonymous functions retain explicit nullable names", () => {
  const value = wire()
  const input = { ...source, text: "const { value: renamed } = input; export default function() {}" }
  value.result.files[0]!.declarationBindings = [
    { kind: "variable", name: null as any, span: { start: 6, length: 25 }, nameSpan: { start: 6, length: 18 } },
    { kind: "function", name: null as any, span: { start: 33, length: input.text.length - 33 }, nameSpan: null as any },
  ]
  expect<unknown>(decode(value, input)).toEqual(value.result)
})

for (const [name, change] of [
  ["missing inventory", (w: any) => { delete w.result.files[0].declarationBindings }],
  ["null inventory", (w: any) => { w.result.files[0].declarationBindings = null }],
  ["unknown declaration kind", (w: any) => { w.result.files[0].declarationBindings[0].kind = "checker-symbol" }],
  ["extra compiler object", (w: any) => { w.result.files[0].declarationBindings[0].symbol = {} }],
  ["missing name", (w: any) => { delete w.result.files[0].declarationBindings[0].name }],
  ["missing name span", (w: any) => { delete w.result.files[0].declarationBindings[0].nameSpan }],
  ["empty name", (w: any) => { w.result.files[0].declarationBindings[0].name = "" }],
  ["nonstrings as names", (w: any) => { w.result.files[0].declarationBindings[0].name = 2 }],
  ["repeated declarations", (w: any) => { w.result.files[0].declarationBindings.push(w.result.files[0].declarationBindings[0]) }],
  ["unsorted declarations", (w: any) => { w.result.files[0].declarationBindings.reverse() }],
  ["out-of-source declaration", (w: any) => { w.result.files[0].declarationBindings[0].span.length = 1000 }],
  ["empty declaration", (w: any) => { w.result.files[0].declarationBindings[0].span.length = 0 }],
  ["negative start", (w: any) => { w.result.files[0].declarationBindings[0].span.start = -1 }],
  ["fractional declaration", (w: any) => { w.result.files[0].declarationBindings[0].span.start = 0.5 }],
  ["missing span field", (w: any) => { delete w.result.files[0].declarationBindings[0].span.start }],
  ["null span", (w: any) => { w.result.files[0].declarationBindings[0].span = null }],
  ["out-of-declaration name", (w: any) => { w.result.files[0].declarationBindings[0].nameSpan.start = 0 }],
  ["empty name span", (w: any) => { w.result.files[0].declarationBindings[0].nameSpan.length = 0 }],
  ["fractional name", (w: any) => { w.result.files[0].declarationBindings[0].nameSpan.start = 6.5 }],
  ["out-of-source name", (w: any) => { w.result.files[0].declarationBindings[0].nameSpan.length = 1000 }],
  ["nameless variable", (w: any) => { w.result.files[0].declarationBindings[0].name = null; w.result.files[0].declarationBindings[0].nameSpan = null }],
  ["anonymous function with a named span", (w: any) => { w.result.files[0].declarationBindings[1].name = null }],
  ["named function without its name span", (w: any) => { w.result.files[0].declarationBindings[1].nameSpan = null }],
] as const) test(`declaration inspection rejects ${name}`, () => {
  const value = wire()
  value.result.files[0]!.declarationBindings[1]!.span.length = source.text.length - 17
  change(value)
  expect(() => decode(value)).toThrow()
})
