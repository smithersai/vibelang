import { expect, test } from "bun:test"
import { decodeNativeTranspile, NATIVE_API_VERSION } from "./protocol.ts"

const revision = "a".repeat(40)
const request = { files: [{ path: "nested/module.ts", text: "export const answer: number = 42;" }] }
const wire = () => ({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result: { files: [{
  path: request.files[0]!.path, emitSkipped: false, javascript: "export const answer = 42;\n", sourceMap: "", diagnostics: [] as any[],
}] } })
const decode = (value: unknown) => decodeNativeTranspile(JSON.stringify(value), revision, request)

test("native transpilation returns ordinary emitted bytes, not compiler objects", () => {
  expect(decode(wire())).toEqual(wire().result)
})
test("native transpilation allows successful empty modules", () => {
  const value = wire()
  value.result.files[0]!.javascript = ""
  expect(decode(value)).toEqual(value.result)
})
test("native transpilation permits option diagnostics without source locations", () => {
  const value = wire()
  Object.assign(value.result.files[0]!, { emitSkipped: true, javascript: "", diagnostics: [
    { code: "TS5052", category: "error", message: "incompatible emission options", phase: "emit" },
  ] })
  expect(decode(value)).toEqual(value.result)
})
test("native transpilation refuses malformed syntax without partial output", () => {
  const value = wire()
  Object.assign(value.result.files[0]!, { emitSkipped: true, javascript: "", diagnostics: [
    { code: "TS1109", category: "error", message: "Expression expected.", phase: "parse", file: request.files[0]!.path, span: { start: 5, length: 1 } },
  ] })
  expect(decode(value)).toEqual(value.result)
})
test("native transpilation accepts version-three maps", () => {
  const value = wire()
  value.result.files[0]!.sourceMap = JSON.stringify({ version: 3, sources: ["module.ts"], names: [], mappings: "" })
  expect(decode(value)).toEqual(value.result)
})

for (const [name, mutate] of [
  ["wrong API", (w: any) => { w.apiVersion-- }],
  ["wrong pin", (w: any) => { w.compilerRevision = "b".repeat(40) }],
  ["missing files", (w: any) => { delete w.result.files }],
  ["null files", (w: any) => { w.result.files = null }],
  ["missing source", (w: any) => { w.result.files = [] }],
  ["duplicate source", (w: any) => { w.result.files.push(w.result.files[0]) }],
  ["wrong source", (w: any) => { w.result.files[0].path = "other.ts" }],
  ["missing bytes", (w: any) => { delete w.result.files[0].javascript }],
  ["nonstring bytes", (w: any) => { w.result.files[0].javascript = 42 }],
  ["repaired surrogate bytes", (w: any) => { w.result.files[0].javascript = "\ud800" }],
  ["nonstring map", (w: any) => { w.result.files[0].sourceMap = {} }],
  ["malformed map", (w: any) => { w.result.files[0].sourceMap = "{" }],
  ["wrong map version", (w: any) => { w.result.files[0].sourceMap = '{"version":2}' }],
  ["null map", (w: any) => { w.result.files[0].sourceMap = "null" }],
  ["missing diagnostics", (w: any) => { delete w.result.files[0].diagnostics }],
  ["unexplained refusal", (w: any) => { w.result.files[0].emitSkipped = true }],
  ["partial error output", (w: any) => { w.result.files[0].emitSkipped = true; w.result.files[0].diagnostics = [{ code: "TS1109", category: "error", message: "bad", phase: "parse" }] }],
  ["partial error map", (w: any) => { Object.assign(w.result.files[0], { emitSkipped: true, javascript: "", sourceMap: '{"version":3}', diagnostics: [{ code: "TS1109", category: "error", message: "bad", phase: "parse" }] }) }],
  ["error marked successful", (w: any) => { w.result.files[0].diagnostics = [{ code: "TS1109", category: "error", message: "bad", phase: "parse" }] }],
  ["diagnostic outside source", (w: any) => { w.result.files[0].diagnostics = [{ code: "TS1", category: "warning", message: "x", phase: "emit", file: "other.ts" }] }],
  ["diagnostic outside text", (w: any) => { w.result.files[0].diagnostics = [{ code: "TS1", category: "warning", message: "x", phase: "emit", file: request.files[0]!.path, span: { start: 0, length: 1000 } }] }],
  ["diagnostic claims checking", (w: any) => { w.result.files[0].diagnostics = [{ code: "TS1", category: "warning", message: "x", phase: "check" }] }],
  ["diagnostic claims language lowering", (w: any) => { w.result.files[0].diagnostics = [{ code: "TS1", category: "warning", message: "x", phase: "lower" }] }],
  ["diagnostic missing phase", (w: any) => { w.result.files[0].diagnostics = [{ code: "TS1", category: "warning", message: "x" }] }],
  ["compiler AST", (w: any) => { w.result.files[0].ast = {} }],
] as const) {
  test(`native transpilation rejects ${name}`, () => {
    const value = wire()
    mutate(value)
    expect(() => decode(value)).toThrow()
  })
}
