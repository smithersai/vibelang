import { describe, expect, test } from "bun:test"
import { decodeNativeResult, decodeNativeInspection, encodeNativeRequest, NATIVE_API_VERSION } from "./protocol.ts"

const revision = "a".repeat(40)
function envelope() {
  return { apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result: {
    diagnostics: [] as unknown[], artifacts: [] as unknown[], emitSkipped: false,
  } }
}

describe("native compiler protocol", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    test(`request refuses non-finite ${value} without conversion to null`, () => {
      expect(() => encodeNativeRequest({ offset: value })).toThrow("non-finite number")
    })
  }
  for (const [name, input] of [
    ["high surrogate", "\ud800"], ["low surrogate", "\udfff"],
    ["reversed pair", "\udc00\ud800"], ["interrupted pair", "\ud800x\udc00"],
    ["nested source", { files: [{ text: "\ud800" }] }],
    ["invalid key", { ["\ud800"]: 1 }],
    ["toJSON result", { toJSON: () => "\udfff" }],
  ] as const) {
    test(`request refuses ${name} without Unicode substitution`, () => {
      expect(() => encodeNativeRequest(input)).toThrow("unpaired UTF-16 surrogate")
    })
  }
  for (const text of ["🐱", "�", "e\u0301", "\\ud800", "\ud800\udc00", "\udbff\udfff"]) {
    test(`request preserves valid Unicode ${JSON.stringify(text)}`, () => {
      expect(JSON.parse(encodeNativeRequest({ text }))).toEqual({ text })
    })
  }
  test("decodes exact success and diagnostics without compiler objects", () => {
    const wire = envelope()
    wire.result.artifacts.push({ path: "turn.js", content: Buffer.from("export default 42").toString("base64") })
    wire.result.diagnostics.push({ code: "TS1234", category: "warning", message: "message", file: "turn.ts", span: { start: 2, length: 4 } })
    expect<unknown>(decodeNativeResult(JSON.stringify(wire), revision)).toEqual(wire.result)
  })
  test("preserves a structured native request refusal", () => {
    const wire = { ...envelope(), error: { code: "CUSTOM", message: "request refused" } }
    expect(() => decodeNativeResult(JSON.stringify(wire), revision)).toThrow("request refused")
  })
  for (const [name, mutate] of [
    ["wrong API", (w: any) => { w.apiVersion-- }],
    ["wrong revision", (w: any) => { w.compilerRevision = "b".repeat(40) }],
    ["unknown envelope field", (w: any) => { w.surprise = true }],
    ["missing result", (w: any) => { delete w.result }],
    ["unknown result field", (w: any) => { w.result.surprise = true }],
    ["null diagnostics", (w: any) => { w.result.diagnostics = null }],
    ["string skipped flag", (w: any) => { w.result.emitSkipped = "false" }],
    ["malformed error", (w: any) => { w.error = { code: 42, message: "wrong" } }],
    ["unknown diagnostic field", (w: any) => { w.result.diagnostics = [{ code: "TS1", category: "error", message: "x", surprise: true }] }],
    ["negative span", (w: any) => { w.result.diagnostics = [{ code: "TS1", category: "error", message: "x", file: "turn.ts", span: { start: -1, length: 2 } }] }],
    ["orphan span", (w: any) => { w.result.diagnostics = [{ code: "TS1", category: "error", message: "x", span: { start: 0, length: 2 } }] }],
    ["fractional span", (w: any) => { w.result.diagnostics = [{ code: "TS1", category: "error", message: "x", file: "turn.ts", span: { start: 0.5, length: 2 } }] }],
    ["unknown category", (w: any) => { w.result.diagnostics = [{ code: "TS1", category: "fatal", message: "x" }] }],
    ["unknown phase", (w: any) => { w.result.diagnostics = [{ code: "TS1", category: "error", message: "x", phase: "maybe" }] }],
    ["unpaired diagnostic surrogate", (w: any) => { w.result.diagnostics = [{ code: "TS1", category: "error", message: "\ud800" }] }],
    ["unpaired artifact path surrogate", (w: any) => { w.result.artifacts = [{ path: "\ud800.js", content: "" }] }],
    ["parent path", (w: any) => { w.result.artifacts = [{ path: "../turn.js", content: "" }] }],
    ["absolute path", (w: any) => { w.result.artifacts = [{ path: "/turn.js", content: "" }] }],
    ["Windows absolute path", (w: any) => { w.result.artifacts = [{ path: "C:/turn.js", content: "" }] }],
    ["duplicate path", (w: any) => { w.result.artifacts = [{ path: "turn.js", content: "" }, { path: "turn.js", content: "" }] }],
    ["invalid base64", (w: any) => { w.result.artifacts = [{ path: "turn.js", content: "!!!" }] }],
    ["noncanonical base64", (w: any) => { w.result.artifacts = [{ path: "turn.js", content: "YQ" }] }],
    ["skipped artifact", (w: any) => { w.result.emitSkipped = true; w.result.artifacts = [{ path: "turn.js", content: "" }] }],
  ] as const) {
    test(`refuses ${name}`, () => {
      const wire = envelope()
      mutate(wire)
      expect(() => decodeNativeResult(JSON.stringify(wire), revision)).toThrow()
    })
  }
  test("refuses multiple JSON responses", () => {
    expect(() => decodeNativeResult(JSON.stringify(envelope()) + "{}", revision)).toThrow("invalid JSON")
  })
})

describe("native inspection protocol", () => {
  const sources = [{ path: "source.ts", text: "import('x')", scriptKind: "typescript" as const }]
  const wire = () => ({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result: {
    files: [{ path: "source.ts", diagnostics: [], moduleSyntax: [{ kind: "dynamic-import", topLevel: false, span: { start: 0, length: 11 }, specifier: "x", specifierKind: "string", specifierSpan: {start:7,length:3} }] }],
  } })
  test("preserves parser facts without exporting an AST", () => {
    expect<unknown>(decodeNativeInspection(JSON.stringify(wire()), revision, sources)).toEqual(wire().result)
  })
  for (const [name, mutate] of [
    ["missing sources", (w: any) => { w.result.files = [] }],
    ["wrong source identity", (w: any) => { w.result.files[0].path = "different.ts" }],
    ["unknown facts", (w: any) => { w.result.files[0].ast = {} }],
    ["unknown module kind", (w: any) => { w.result.files[0].moduleSyntax[0].kind = "unknown" }],
    ["missing top level membership", (w: any) => { delete w.result.files[0].moduleSyntax[0].topLevel }],
    ["nonboolean top level membership", (w: any) => { w.result.files[0].moduleSyntax[0].topLevel = 1 }],
    ["an expression is not a top level statement", (w: any) => { w.result.files[0].moduleSyntax[0].topLevel = true }],
    ["out-of-source module span", (w: any) => { w.result.files[0].moduleSyntax[0].span.length = 99 }],
    ["fractional module span", (w: any) => { w.result.files[0].moduleSyntax[0].span.start = 0.5 }],
    ["nonstrings as specifiers", (w: any) => { w.result.files[0].moduleSyntax[0].specifier = 42 }],
    ["missing literal span", (w: any) => { delete w.result.files[0].moduleSyntax[0].specifierSpan }],
    ["missing literal kind", (w: any) => { delete w.result.files[0].moduleSyntax[0].specifierKind }],
    ["unknown literal kind", (w: any) => { w.result.files[0].moduleSyntax[0].specifierKind = "expression" }],
    ["invented literal facts", (w: any) => { delete w.result.files[0].moduleSyntax[0].specifier }],
    ["literal beyond parent", (w: any) => { w.result.files[0].moduleSyntax[0].specifierSpan.length = 99 }],
    ["literal before parent", (w: any) => { w.result.files[0].moduleSyntax[0].span.start = 8; w.result.files[0].moduleSyntax[0].span.length = 3 }],
    ["fractional literal span", (w: any) => { w.result.files[0].moduleSyntax[0].specifierSpan.start = 7.5 }],
    ["out-of-source diagnostics", (w: any) => { w.result.files[0].diagnostics = [{ code: "TS1", message: "x", category: "error", file: "source.ts", span: { start: 99, length: 1 } }] }],
    ["wrong diagnostic owner", (w: any) => { w.result.files[0].diagnostics = [{ code: "TS1", message: "x", category: "error", file: "other.ts" }] }],
  ] as const) {
    test(`rejects ${name}`, () => {
      const value = wire()
      mutate(value)
      expect(() => decodeNativeInspection(JSON.stringify(value), revision, sources)).toThrow()
    })
  }
})
