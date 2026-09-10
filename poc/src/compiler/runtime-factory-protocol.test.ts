import { expect, test } from "bun:test"
import { decodeNativeRuntimeFactory, NATIVE_API_VERSION } from "./protocol.ts"

const revision = "a".repeat(40)
const wire = () => ({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result: { ok: true, code: "function (runtime) { return 42 }", message: "" } })
const decode = (value: unknown) => decodeNativeRuntimeFactory(JSON.stringify(value), revision)
test("native runtime factory protocol preserves emitted code only on success", () => {
  expect<unknown>(decode(wire())).toEqual(wire().result)
  const value = wire(); value.result = { ok: false, code: "", message: "unbound import" }
  expect(decode(value).ok).toBe(false)
})
for (const [name, mutate] of [
  ["missing code", (v:any) => { delete v.result.code }],
  ["partial refusal", (v:any) => { v.result.ok = false; v.result.message = "unbound import" }],
  ["success message", (v:any) => { v.result.message = "ignored" }],
  ["missing success output", (v:any) => { v.result.code = "" }],
  ["output budget", (v:any) => { v.result.code = " ".repeat(4*1024*1024+1) }],
  ["unknown fields", (v:any) => { v.result.signature = "not an authentication proof" }],
  ["wrong source pin", (v:any) => { v.compilerRevision = "b".repeat(40) }],
] as const) test(`native runtime factory protocol rejects ${name}`, () => {
  const value = wire(); mutate(value); expect(() => decode(value)).toThrow()
})
