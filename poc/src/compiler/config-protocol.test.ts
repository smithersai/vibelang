import { expect, test } from "bun:test"
import { decodeNativeConfig, NATIVE_API_VERSION } from "./protocol.ts"

const revision = "a".repeat(40), request = { path: "../configs/project.json", text: "// 😀\n{}" }
const wire = (): any => ({ apiVersion:NATIVE_API_VERSION, compilerRevision:revision, result:{diagnostics:[]} })
const refused = (): any => { const value = wire(); value.result.diagnostics = [{code:"VIBE6001",category:"error",message:"missing strict",file:request.path,span:{start:6,length:2}}]; return value }
const decode = (value: unknown) => decodeNativeConfig(JSON.stringify(value), revision, request)
test("native configuration protocol retains positioned refusals and empty success", () => {
  expect(decode(wire()).diagnostics).toEqual([])
  expect(decode(refused()).diagnostics[0]?.span).toEqual({start:6,length:2})
  const parsed = refused(); parsed.result.diagnostics[0].code = "TS1005"; parsed.result.diagnostics[0].phase = "parse"
  expect(decode(parsed).diagnostics[0]?.code).toBe("TS1005")
  const empty = refused(); empty.result.diagnostics[0].span = {start:0,length:0}
  expect(decodeNativeConfig(JSON.stringify(empty), revision, {...request,text:""}).diagnostics[0]?.span?.length).toBe(0)
})
for (const [name, mutate] of [
  ["wrong pin", (v:any) => { v.compilerRevision = "b".repeat(40) }],
  ["wrong API", (v:any) => { v.apiVersion-- }],
  ["extra compiler object", (v:any) => { v.result.options = {} }],
  ["missing diagnostics", (v:any) => { delete v.result.diagnostics }],
  ["null diagnostics", (v:any) => { v.result.diagnostics = null }],
  ["diagnostic budget", (v:any) => { v.result.diagnostics = Array(4097).fill(v.result.diagnostics[0]) }],
] as const) test(`native configuration protocol refuses ${name}`, () => { const value = refused(); mutate(value); expect(() => decode(value)).toThrow() })
for (const [name, mutate] of [
  ["foreign label", (v:any) => { v.file = "other.json" }],
  ["missing span", (v:any) => { delete v.span }],
  ["wrong family", (v:any) => { v.code = "VIBE1101" }],
  ["unrecognized option code", (v:any) => { v.code = "VIBE6004" }],
  ["wrong parse phase", (v:any) => { v.code = "TS1005"; v.phase = "check" }],
  ["unexpected policy phase", (v:any) => { v.phase = "check" }],
  ["warning refusal", (v:any) => { v.category = "warning" }],
  ["negative start", (v:any) => { v.span.start = -1 }],
  ["negative length", (v:any) => { v.span.length = -1 }],
  ["past EOF", (v:any) => { v.span.length++ }],
  ["fractional range", (v:any) => { v.span.start = 0.5 }],
  ["non-scalar message", (v:any) => { v.message = "\ud800" }],
] as const) test(`native configuration protocol refuses ${name}`, () => { const value = refused(); mutate(value.result.diagnostics[0]); expect(() => decode(value)).toThrow() })
