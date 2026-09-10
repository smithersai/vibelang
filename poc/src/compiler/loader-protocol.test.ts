import { describe, expect, test } from "bun:test"
import { decodeNativeLoaderRegistration, NATIVE_API_VERSION } from "./protocol.ts"

const revision = "a".repeat(40)
const request = { mode: "recognize" as const, fileName: "loader.ts", source: "// 🐱\r\nexport default 42;" }
const wire = () => ({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result: {
  candidate: true, ok: true, identified: true, diagnostics: [] as unknown[],
  registration: { fileName: request.fileName, type: "yaml", sandboxSource: "export default () => 42;", line: 2, column: 1 },
} })

describe("native loader registration protocol", () => {
  test("returns located compiler facts, not compiler-library objects", () => {
    expect<unknown>(decodeNativeLoaderRegistration(JSON.stringify(wire()), revision, request)).toEqual(wire().result)
  })
  test("a spelling-only candidate grants neither authority nor liability", () => {
    const result = { candidate: true, ok: true, identified: false, diagnostics: [] }
    expect(decodeNativeLoaderRegistration(JSON.stringify({ ...wire(), result }), revision, { ...request, mode: "discover" })).toEqual(result)
  })
  test("an identified malformed registration retains its diagnostic", () => {
    const result = { candidate: true, ok: false, identified: true, diagnostics: [{
      code: "VCT1307", severity: "error", message: "invalid type", fileName: request.fileName, line: 2, column: 16,
    }] }
    expect<unknown>(decodeNativeLoaderRegistration(JSON.stringify({ ...wire(), result }), revision, request)).toEqual(result)
  })
  for (const [name, mutate] of [
    ["wrong API", (w: any) => { w.apiVersion-- }],
    ["wrong revision", (w: any) => { w.compilerRevision = "b".repeat(40) }],
    ["unknown facts", (w: any) => { w.result.ast = {} }],
    ["nonnumeric position", (w: any) => { w.result.registration.line = "2" }],
    ["wrong source", (w: any) => { w.result.registration.fileName = "other.ts" }],
    ["missing source", (w: any) => { delete w.result.registration.fileName }],
    ["unrecognized success", (w: any) => { w.result.identified = false }],
    ["missing registration", (w: any) => { delete w.result.registration }],
    ["failed registration", (w: any) => { w.result.ok = false }],
    ["source line escape", (w: any) => { w.result.registration.line = 3 }],
    ["source column escape", (w: any) => { w.result.registration.column = 100 }],
    ["negative column", (w: any) => { w.result.registration.column = -1 }],
    ["fractional line", (w: any) => { w.result.registration.line = 1.5 }],
    ["glob type", (w: any) => { w.result.registration.type = "*.yaml" }],
    ["uppercase type", (w: any) => { w.result.registration.type = "YAML" }],
    ["nontext sandbox", (w: any) => { w.result.registration.sandboxSource = {} }],
    ["surrogate repair", (w: any) => { w.result.registration.sandboxSource = "\ud800" }],
    ["null diagnostics", (w: any) => { w.result.diagnostics = null }],
    ["success diagnostics", (w: any) => { w.result.diagnostics.push({}) }],
  ] as const) {
    test(`refuses ${name}`, () => {
      const value = wire()
      mutate(value)
      expect(() => decodeNativeLoaderRegistration(JSON.stringify(value), revision, request)).toThrow()
    })
  }
  test("discovery cannot return a checked registration", () => {
    expect(() => decodeNativeLoaderRegistration(JSON.stringify(wire()), revision, { ...request, mode: "discover" })).toThrow()
  })
  for (const code of ["VCT1310", "TS1005", "VCT13000", "other"]) {
    test(`only the native registration diagnostic family crosses this operation: ${code}`, () => {
      const result = { candidate: true, ok: false, identified: true, diagnostics: [{
        code, severity: "error", message: "invalid type", fileName: request.fileName, line: 2, column: 16,
      }] }
      expect(() => decodeNativeLoaderRegistration(JSON.stringify({ ...wire(), result }), revision, request)).toThrow()
    })
  }
})
