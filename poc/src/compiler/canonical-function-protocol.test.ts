import { expect, test } from "bun:test"
import { decodeNativeCanonicalFunction, NATIVE_API_VERSION } from "./protocol.ts"

const revision = "a".repeat(40)
const wire = () => ({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result: { ok: true, code: "(() => 42)", message: "" } })
const decode = (value: unknown) => decodeNativeCanonicalFunction(JSON.stringify(value), revision)
test("native canonical function returns code without granting checked-source authority", () => {
  expect(decode(wire())).toEqual(wire().result)
})
test("native canonical function refuses without a partial fingerprint", () => {
  const result = { ok: false, code: "", message: "source is not a standalone function expression" }
  expect(decode({ ...wire(), result })).toEqual(result)
})
for (const [name, mutate] of [
  ["wrong API", (w: any) => { w.apiVersion-- }],
  ["wrong compiler", (w: any) => { w.compilerRevision = "b".repeat(40) }],
  ["missing code", (w: any) => { delete w.result.code }],
  ["missing message", (w: any) => { delete w.result.message }],
  ["nonboolean success", (w: any) => { w.result.ok = 1 }],
  ["empty success", (w: any) => { w.result.code = "" }],
  ["success with refusal", (w: any) => { w.result.message = "bad" }],
  ["partial refusal", (w: any) => { w.result.ok = false; w.result.message = "bad" }],
  ["unexplained refusal", (w: any) => { w.result.ok = false; w.result.code = "" }],
  ["surrogate repair", (w: any) => { w.result.code = "\ud800" }],
  ["compiler objects", (w: any) => { w.result.ast = {} }],
] as const) test(`native canonical function rejects ${name}`, () => {
  const value = wire()
  mutate(value)
  expect(() => decode(value)).toThrow()
})
