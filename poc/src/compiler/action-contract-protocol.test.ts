import { expect, test } from "bun:test"
import { decodeNativeActionContract, NATIVE_API_VERSION, type NativeActionContractRequest } from "./protocol.ts"

const revision = "a".repeat(40)
const request: NativeActionContractRequest = { source: "export class Work {}", fileName: "actions.vibe", exportName: "Work", id: "test/Work", version: 1 }
const schema = (role: string) => ({ format: "canonical-json", schemaVersion: 1, role, shape: "structural", source: "compiler-derived", descriptor: { kind: "number" }, digest: "b".repeat(64) })
const descriptor = () => ({ id: request.id, version: 1, contractDigest: "c".repeat(64), inputSchema: schema("input"), successSchema: schema("success"), errorSchema: schema("error") })
const wire = () => ({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result: { ok: true, diagnostics: [] as unknown[], contractJson: JSON.stringify(descriptor()) } })
const failure = () => ({ ...wire(), result: { ok: false, contractJson: "", diagnostics: [{ code: "VIBE4202", category: "error", message: "invalid contract", file: request.fileName, span: { start: 0, length: 1 }, phase: "check" }] } })
const decode = (value: unknown) => decodeNativeActionContract(JSON.stringify(value), revision, request)
test("native Action contract transport distinguishes data from source refusals", () => {
  expect(decode(wire()).ok).toBe(true)
  expect(decode(failure()).ok).toBe(false)
})
for (const [name, mutate] of [
  ["missing diagnostics", (v: any) => { delete v.result.diagnostics }],
  ["null diagnostics", (v: any) => { v.result.diagnostics = null }],
  ["missing output", (v: any) => { v.result.contractJson = "" }],
  ["invalid output JSON", (v: any) => { v.result.contractJson = "{" }],
  ["partial refusal", (v: any) => { v.result.ok = false }],
  ["wrong pin", (v: any) => { v.compilerRevision = "d".repeat(40) }],
  ["wrong API", (v: any) => { v.apiVersion = -1 }],
  ["unknown fields", (v: any) => { v.result.checker = {} }],
  ["output budget", (v: any) => { v.result.contractJson = " ".repeat(16*1024*1024+1) }],
] as const) test(`native Action contract transport rejects ${name}`, () => {
  const value = wire(); mutate(value); expect(() => decode(value)).toThrow()
})
for (const [name, mutate] of [
  ["changed id", (v: any) => { v.id = "other/Work" }],
  ["changed version", (v: any) => { v.version = 2 }],
  ["missing contract digest", (v: any) => { delete v.contractDigest }],
  ["invalid contract digest", (v: any) => { v.contractDigest = "00" }],
  ["wrong schema role", (v: any) => { v.inputSchema.role = "error" }],
  ["missing schema field", (v: any) => { delete v.errorSchema.source }],
  ["legacy JSON hole", (v: any) => { v.inputSchema.shape = "json-value" }],
  ["compiler object", (v: any) => { v.program = {} }],
  ["invalid schema digest", (v: any) => { v.inputSchema.digest = "00" }],
  ["non-scalar data", (v: any) => { v.inputSchema.descriptor = { kind: "literal", value: "\ud800" } }],
  ["non-scalar key", (v: any) => { v.inputSchema.descriptor["\ud800"] = true }],
  ["excessive traversal depth", (v: any) => { let item = v.inputSchema.descriptor; for (let i = 0; i < 260; i++) item = item.child = {} }],
] as const) test(`native Action contract transport rejects ${name}`, () => {
  const contract = descriptor(); mutate(contract); const value = wire(); value.result.contractJson = JSON.stringify(contract); expect(() => decode(value)).toThrow()
})
for (const [name, mutate] of [
  ["foreign diagnostic", (v: any) => { v.file = "other.vibe" }],
  ["wrong diagnostic family", (v: any) => { v.code = "VIBE4100" }],
  ["wrong phase", (v: any) => { v.phase = "lower" }],
  ["warning as refusal", (v: any) => { v.category = "warning" }],
  ["missing position", (v: any) => { delete v.span }],
  ["out of source", (v: any) => { v.span.start = request.source.length + 1 }],
  ["oversized range", (v: any) => { v.span.length = request.source.length + 1 }],
  ["zero range", (v: any) => { v.span.length = 0 }],
] as const) test(`native Action contract transport rejects ${name}`, () => {
  const value = failure(); mutate(value.result.diagnostics[0]); expect(() => decode(value)).toThrow()
})
