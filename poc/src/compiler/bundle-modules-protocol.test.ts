import { expect, test } from "bun:test"
import { decodeNativeBundleModules, NATIVE_API_VERSION } from "./protocol.ts"

const revision = "a".repeat(40)
const request = {
  files: [{ path: "module.ts", text: "" }], runtimeSpecifier: "test:runtime",
  runtimeHelpers: ["__vsRegisterError"], registrationExport: "__vsRegisterError",
}
const wire = () => ({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result: {
  diagnostics: [] as any[], registrations: [{ path: "module.ts", className: "Failed", identity: "issued:Failed" }],
} })
const decode = (value: unknown) => decodeNativeBundleModules(JSON.stringify(value), revision, request)

test("native worker-module analysis returns compiler-issued registration facts", () => {
  expect(decode(wire())).toEqual(wire().result)
})
test("native worker-module analysis can return an empty valid closure", () => {
  const value = wire()
  value.result.registrations = []
  expect(decode(value)).toEqual(value.result)
})
test("native worker-module refusal publishes no partial registration facts", () => {
  const value = wire()
  value.result.registrations = []
  value.result.diagnostics = [{ path: "module.ts", message: "imports external module 'outside'" }]
  expect(decode(value)).toEqual(value.result)
})
for (const [name, mutate] of [
  ["wrong API", (w: any) => { w.apiVersion-- }],
  ["wrong compiler", (w: any) => { w.compilerRevision = "b".repeat(40) }],
  ["missing diagnostics", (w: any) => { delete w.result.diagnostics }],
  ["null diagnostics", (w: any) => { w.result.diagnostics = null }],
  ["missing registrations", (w: any) => { delete w.result.registrations }],
  ["null registrations", (w: any) => { w.result.registrations = null }],
  ["partial refusal", (w: any) => { w.result.diagnostics = [{ path: "module.ts", message: "refused" }] }],
  ["out of project registration", (w: any) => { w.result.registrations[0].path = "outside.ts" }],
  ["missing registration path", (w: any) => { delete w.result.registrations[0].path }],
  ["empty class name", (w: any) => { w.result.registrations[0].className = "" }],
  ["nonstring class name", (w: any) => { w.result.registrations[0].className = 42 }],
  ["missing identity", (w: any) => { delete w.result.registrations[0].identity }],
  ["nonstring identity", (w: any) => { w.result.registrations[0].identity = 42 }],
  ["surrogate repair", (w: any) => { w.result.registrations[0].identity = "\ud800" }],
  ["duplicate class name", (w: any) => { w.result.registrations.push(w.result.registrations[0]) }],
  ["ambiguous class name", (w: any) => { w.result.registrations.push({ ...w.result.registrations[0], identity: "different" }) }],
  ["out of project diagnostic", (w: any) => { w.result.registrations = []; w.result.diagnostics = [{ path: "outside.ts", message: "refused" }] }],
  ["empty diagnostic", (w: any) => { w.result.registrations = []; w.result.diagnostics = [{ path: "module.ts", message: "" }] }],
  ["compiler AST", (w: any) => { w.result.ast = {} }],
  ["compiler symbol", (w: any) => { w.result.registrations[0].symbol = {} }],
] as const) {
  test(`native worker-module analysis rejects ${name}`, () => {
    const value = wire()
    mutate(value)
    expect(() => decode(value)).toThrow()
  })
}
