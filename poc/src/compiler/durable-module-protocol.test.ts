import { describe, expect, test } from "bun:test"
import { decodeNativeDurableModule, NATIVE_API_VERSION } from "./protocol.ts"

const revision = "a".repeat(40)
const source = " ".repeat(120)
const wire = () => ({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result: {
  diagnostics: [] as unknown[], imports: [{ start: 0, length: 10 }], calls: [{ start: 100, length: 20 }],
  removals: [{ start: 20, length: 20 }, { start: 40, length: 10 }],
} })
const decode = (value: unknown) => decodeNativeDurableModule(JSON.stringify(value), revision, source)

describe("native durable module rewrite protocol", () => {
  test("accepts disjoint authored spans including adjacent removals", () => {
    expect<unknown>(decode(wire())).toEqual(wire().result)
  })
  test("retains nested-call facts without claiming a helper-removal plan", () => {
    const value = wire()
    value.result.calls = [{ start: 60, length: 40 }, { start: 70, length: 15 }]
    value.result.removals = []
    expect(decode(value).calls).toHaveLength(2)
  })
  test("parse and bind refusals carry diagnostics only", () => {
    for (const phase of ["parse", "bind"]) {
      const value = wire()
      value.result.imports = value.result.calls = value.result.removals = []
      value.result.diagnostics = [{ code: "VIBE1000", category: "error", message: "invalid source", file: "durable-module.vibe", phase, span: { start: 1, length: 1 } }]
      expect(decode(value).diagnostics).toHaveLength(1)
    }
  })
  for (const [name, mutate] of [
    ["unknown result field", (v:any) => { v.result.body = {} }],
    ["missing collection", (v:any) => { delete v.result.calls }],
    ["null collection", (v:any) => { v.result.removals = null }],
    ["partial refusal", (v:any) => { v.result.diagnostics = [{ code: "VIBE1000", category: "error", message: "invalid" }] }],
    ["removals without a call", (v:any) => { v.result.calls = [] }],
    ["removals with multiple calls", (v:any) => { v.result.calls.push({ start: 110, length: 10 }) }],
    ["reversed spans", (v:any) => { v.result.removals.reverse() }],
    ["overlapping removals", (v:any) => { v.result.removals[0].length = 21 }],
    ["call overlapping a removal", (v:any) => { v.result.calls[0] = { start: 30, length: 10 } }],
    ["import overlapping a removal", (v:any) => { v.result.imports[0].length = 25 }],
    ["duplicate calls", (v:any) => { v.result.removals = []; v.result.calls.push(v.result.calls[0]) }],
    ["fractional span", (v:any) => { v.result.calls[0].start = 100.5 }],
    ["negative span", (v:any) => { v.result.imports[0].start = -1 }],
    ["empty span", (v:any) => { v.result.calls[0].length = 0 }],
    ["out-of-source span", (v:any) => { v.result.calls[0].length = 21 }],
    ["unknown span field", (v:any) => { v.result.calls[0].text = "not compiler source" }],
    ["span budget", (v:any) => { v.result.calls = Array.from({ length: 100001 }, () => ({ start: 1, length: 1 })); v.result.removals = [] }],
  ] as const) test(`rejects ${name}`, () => {
    const value = wire(); mutate(value); expect(() => decode(value)).toThrow()
  })
  for (const [name, fields] of [
    ["foreign source", { file: "other.vibe" }], ["checking certificate", { phase: "check" }],
    ["missing phase", { phase: undefined }], ["unbounded diagnostic", { span: { start: 1, length: 121 } }],
  ] as const) test(`rejects ${name}`, () => {
    const value = wire()
    value.result.imports = value.result.calls = value.result.removals = []
    value.result.diagnostics = [{ code: "VIBE1000", category: "error", message: "invalid", file: "durable-module.vibe", phase: "parse", ...fields }]
    expect(() => decode(value)).toThrow()
  })
})
