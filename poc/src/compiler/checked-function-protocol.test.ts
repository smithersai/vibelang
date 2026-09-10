import { expect, test } from "bun:test"
import { decodeNativeCheckedFunction, NATIVE_API_VERSION, type NativeCheckedFunctionRequest } from "./protocol.ts"

const revision = "a".repeat(40)
const source = "// 😀\nexport function work(n: number) { return n + 1; }"
const request: NativeCheckedFunctionRequest = {
  files: [{ path: "main.vibe", kind: "vibelang", text: source }], entryFile: "main.vibe", exportName: "work"
}
const schema = () => ({ format: "canonical-json", schemaVersion: 1, role: "error", shape: "structural", source: "compiler-derived", descriptor: { kind: "never" }, digest: "b".repeat(64) })
const wire = (): any => ({
  apiVersion: NATIVE_API_VERSION, compilerRevision: revision,
  result: { ok: true, diagnostics: [], message: "", function: {
    file: "main.vibe", name: "work", span: { start: 6, length: source.length - 6 },
    requirements: [], typedFailures: [], panic: false, failureSchemaJson: JSON.stringify(schema()), valueSchemasJson: ""
  } }
})
const refusal = (): any => ({ ...wire(), result: {
  ok: false, diagnostics: [{ code: "TS2322", category: "error", message: "incompatible", file: "main.vibe", span: { start: 6, length: 1 }, phase: "check" }],
  message: "implementation project did not pass native checked lowering", function: null
} })
const decode = (value: unknown) => decodeNativeCheckedFunction(JSON.stringify(value), revision, request)

test("native checked-function protocol distinguishes checked facts from refused exports and failed programs", () => {
  const good = decode(wire())
  expect(good.ok).toBe(true)
  expect(source.slice(good.function!.span.start)).toStartWith("export function work")
  expect(decode(refusal()).function).toBeNull()
  const missing = refusal(); missing.result.diagnostics = []; missing.result.message = "missing export"
  expect(decode(missing).ok).toBe(false)
  const warned = wire(); warned.result.diagnostics = refusal().result.diagnostics
  warned.result.diagnostics[0].category = "warning"
  expect(decode(warned).ok).toBe(true)
})

for (const [name, mutate] of [
  ["wrong pin", (v: any) => { v.compilerRevision = "c".repeat(40) }],
  ["wrong API", (v: any) => { v.apiVersion-- }],
  ["unknown envelope field", (v: any) => { v.program = {} }],
  ["missing diagnostics", (v: any) => { delete v.result.diagnostics }],
  ["null diagnostics", (v: any) => { v.result.diagnostics = null }],
  ["missing function", (v: any) => { delete v.result.function }],
  ["null function", (v: any) => { v.result.function = null }],
  ["success with errors", (v: any) => { v.result.diagnostics = refusal().result.diagnostics }],
  ["success with message", (v: any) => { v.result.message = "failed" }],
  ["partial refusal", (v: any) => { v.result.ok = false }],
  ["compiler object", (v: any) => { v.result.checker = {} }],
] as const) test(`native checked-function protocol refuses ${name}`, () => {
  const value = wire(); mutate(value); expect(() => decode(value)).toThrow()
})
for (const [name, mutate] of [
  ["foreign source", (v: any) => { v.file = "other.vibe" }],
  ["different export", (v: any) => { v.name = "other" }],
  ["extra fact", (v: any) => { v.ast = {} }],
  ["negative start", (v: any) => { v.span.start = -1 }],
  ["empty range", (v: any) => { v.span.length = 0 }],
  ["fractional range", (v: any) => { v.span.length = 1.5 }],
  ["beyond source", (v: any) => { v.span.length++ }],
  ["unsafe range", (v: any) => { v.span.start = Number.MAX_SAFE_INTEGER }],
  ["non-boolean defect", (v: any) => { v.panic = "false" }],
  ["null requirements", (v: any) => { v.requirements = null }],
  ["missing failures", (v: any) => { delete v.typedFailures }],
  ["duplicate requirement", (v: any) => { v.requirements = ["Database", "Database"] }],
  ["unsorted failures", (v: any) => { v.typedFailures = ["Z", "A"] }],
  ["empty row name", (v: any) => { v.typedFailures = [""] }],
  ["non-scalar row", (v: any) => { v.requirements = ["\ud800"] }],
  ["NUL row", (v: any) => { v.requirements = ["A\0B"] }],
  ["oversized row", (v: any) => { v.requirements = ["a".repeat(16 * 1024 + 1)] }],
  ["empty schema", (v: any) => { v.failureSchemaJson = "" }],
  ["malformed schema", (v: any) => { v.failureSchemaJson = "{" }],
  ["oversized schema", (v: any) => { v.failureSchemaJson = " ".repeat(8 * 1024 * 1024 + 1) }],
] as const) test(`native checked-function protocol refuses ${name}`, () => {
  const value = wire(); mutate(value.result.function); expect(() => decode(value)).toThrow()
})
for (const [name, mutate] of [
  ["wrong codec role", (v: any) => { v.role = "input" }],
  ["missing codec provenance", (v: any) => { delete v.source }],
  ["legacy codec", (v: any) => { v.shape = "json-value" }],
  ["invalid codec digest", (v: any) => { v.digest = "00" }],
  ["array descriptor", (v: any) => { v.descriptor = [] }],
  ["non-scalar payload", (v: any) => { v.descriptor.value = "\udfff" }],
  ["non-scalar field", (v: any) => { v.descriptor["\ud800"] = "bad" }],
  ["excessive depth", (v: any) => { let item = v.descriptor; for (let i = 0; i < 260; i++) item = item.child = {} }],
] as const) test(`native checked-function protocol refuses ${name}`, () => {
  const value = wire(), codec = schema(); mutate(codec); value.result.function.failureSchemaJson = JSON.stringify(codec)
  expect(() => decode(value)).toThrow()
})
test("native checked-function protocol bounds source diagnostics", () => {
  for (const span of [{ start: -1, length: 1 }, { start: source.length + 1, length: 1 }, { start: 0, length: source.length + 1 }]) {
    const value = refusal(); value.result.diagnostics[0].span = span; expect(() => decode(value)).toThrow()
  }
  const value = refusal(); value.result.message = "x".repeat(16 * 1024 + 1); expect(() => decode(value)).toThrow()
})

const boundaryWire = (): any => {
  const value = wire()
  value.result.function.valueSchemasJson = JSON.stringify({
    completion: "value",
    inputSchema: { ...schema(), role: "input", descriptor: { kind: "number" } },
    successSchema: { ...schema(), role: "success", descriptor: { kind: "number" } },
  })
  return value
}
const decodeBoundary = (value: unknown) => decodeNativeCheckedFunction(JSON.stringify(value), revision, { ...request, durableBoundary: true })

test("durable function values are an explicit request/response contract", () => {
  expect(decodeBoundary(boundaryWire()).function!.valueSchemasJson).not.toBe("")
  expect(() => decodeBoundary(wire())).toThrow()
  expect(() => decode(boundaryWire())).toThrow()
  expect(decodeNativeCheckedFunction(JSON.stringify(wire()), revision, { ...request, durableBoundary: false }).ok).toBe(true)
  expect(decodeBoundary(refusal()).function).toBeNull()
  const duplicate = boundaryWire()
  duplicate.result.function.valueSchemasJson = duplicate.result.function.valueSchemasJson.replace('"role":"input"', '"role":"input","role":"input"')
  expect(() => decodeBoundary(duplicate)).toThrow("lossless")
})

for (const [name, mutate] of [
  ["missing value schemas", (v: any) => { delete v.valueSchemasJson }],
  ["null value schemas", (v: any) => { v.valueSchemasJson = null }],
  ["invalid value schema JSON", (v: any) => { v.valueSchemasJson = "{" }],
  ["unbounded value schemas", (v: any) => { v.valueSchemasJson = " ".repeat(16 * 1024 * 1024 + 1) }],
] as const) test(`durable function protocol refuses ${name}`, () => {
  const value = boundaryWire(); mutate(value.result.function); expect(() => decodeBoundary(value)).toThrow()
})

for (const [name, mutate] of [
  ["missing input", (v: any) => { delete v.inputSchema }],
  ["missing success", (v: any) => { delete v.successSchema }],
  ["missing convention", (v: any) => { delete v.completion }],
  ["invalid convention", (v: any) => { v.completion = "thenable" }],
  ["extra schema", (v: any) => { v.failureSchema = schema() }],
  ["wrong input role", (v: any) => { v.inputSchema.role = "success" }],
  ["wrong success role", (v: any) => { v.successSchema.role = "input" }],
  ["legacy success", (v: any) => { v.successSchema.shape = "json-value" }],
  ["invalid success digest", (v: any) => { v.successSchema.digest = "c" }],
  ["extra source proof", (v: any) => { v.inputSchema.checker = {} }],
  ["bad success Unicode", (v: any) => { v.successSchema.descriptor.value = "\ud800" }],
  ["deep input", (v: any) => { let p = v.inputSchema.descriptor; for (let i = 0; i < 260; i++) p = p.next = {} }],
] as const) test(`durable function protocol refuses ${name}`, () => {
  const value = boundaryWire(), schemas = JSON.parse(value.result.function.valueSchemasJson)
  mutate(schemas); value.result.function.valueSchemasJson = JSON.stringify(schemas)
  expect(() => decodeBoundary(value)).toThrow()
})
