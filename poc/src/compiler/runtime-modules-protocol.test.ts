import { describe, expect, test } from "bun:test"
import { decodeNativeRuntimeModules, NATIVE_API_VERSION } from "./protocol.ts"

const revision = "a".repeat(40)
const request = { resolutionRoot: "/project", files: [{ path: "main.ts", text: '// 🦀\r\nimport "./lib";' }] }
const wire = () => ({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result: { files: [{
  path: "main.ts", leadingNoThrow: false, firstStatement: { start: 7, line: 2, column: 1 },
  edges: [{ kind: "import", specifier: "./lib", start: 14, end: 21, typeOnly: false, moduleInitialization: true, attributes: false }],
  resolutions: [{ specifier: "./lib", runtimePath: "lib.ts", typePath: "lib.ts", message: "" }],
  diagnostics: [] as unknown[], parseDiagnostics: [] as unknown[],
}] } })
const decode = (value: unknown) => decodeNativeRuntimeModules(JSON.stringify(value), revision, request)

describe("native runtime module protocol", () => {
  test("returns bounded native edges, positions and resolution paths", () => {
    expect<unknown>(decode(wire())).toEqual(wire().result)
  })
  test("no explicit root means no filesystem resolution authority", () => {
    const value = wire()
    value.result.files[0]!.resolutions = []
    expect(decodeNativeRuntimeModules(JSON.stringify(value), revision, { files: request.files }).files[0]!.resolutions).toEqual([])
    expect(() => decode(value)).toThrow()
    expect(() => decodeNativeRuntimeModules(JSON.stringify(wire()), revision, { files: request.files })).toThrow()
  })
  test("resolution refusal and absence carry no partial path", () => {
    for (const message of ["", "symbolic-link alias"]) {
      const value = wire() as any
      value.result.files[0].resolutions = [{ specifier: "./lib", message }]
      expect(decode(value).files[0]!.resolutions[0]!.runtimePath).toBeUndefined()
    }
  })
  test("policy refusal has a source position and no partial graph", () => {
    const value = wire()
    const file = value.result.files[0]!
    file.edges = []
    file.resolutions = []
    file.diagnostics = [{ start: 14, line: 2, column: 8, message: "refused" }]
    expect(decode(value).files[0]!.diagnostics).toHaveLength(1)
  })
  test("parse recovery is explicit, distinct from policy and never claims checking", () => {
    const value = wire()
    value.result.files[0]!.parseDiagnostics = [{ code: "TS1109", category: "error", message: "expression expected", file: "main.ts", span: { start: 21, length: 1 }, phase: "parse" }]
    expect(decode(value).files[0]!.parseDiagnostics).toHaveLength(1)
  })
  test("JavaScript companion resolution is required even with no edges", () => {
    const value = wire() as any
    const file = value.result.files[0]
    file.path = "main.mjs"
    file.edges = []
    file.resolutions = [{ specifier: "./main.mjs", runtimePath: "main.mjs", typePath: "main.d.mts", message: "" }]
    const input = { ...request, files: [{ ...request.files[0]!, path: "main.mjs" }] }
    expect(decodeNativeRuntimeModules(JSON.stringify(value), revision, input).files[0]!.resolutions).toHaveLength(1)
    file.resolutions = []
    expect(() => decodeNativeRuntimeModules(JSON.stringify(value), revision, input)).toThrow()
  })
  for (const [name, mutate] of [
    ["wrong API", (w: any) => { w.apiVersion-- }],
    ["wrong revision", (w: any) => { w.compilerRevision = "b".repeat(40) }],
    ["unknown envelope", (w: any) => { w.checked = true }],
    ["missing file", (w: any) => { w.result.files = [] }],
    ["foreign file", (w: any) => { w.result.files[0].path = "other.ts" }],
    ["invented AST", (w: any) => { w.result.files[0].ast = {} }],
    ["null edges", (w: any) => { w.result.files[0].edges = null }],
    ["nonboolean trust", (w: any) => { w.result.files[0].leadingNoThrow = 1 }],
    ["missing first position", (w: any) => { delete w.result.files[0].firstStatement }],
    ["byte offset instead of UTF16", (w: any) => { w.result.files[0].firstStatement.start = 9 }],
    ["outside first line", (w: any) => { w.result.files[0].firstStatement.line = 3 }],
    ["outside column", (w: any) => { w.result.files[0].firstStatement.column = 100 }],
    ["fractional column", (w: any) => { w.result.files[0].firstStatement.column = 1.5 }],
    ["unknown edge", (w: any) => { w.result.files[0].edges[0].kind = "type-query" }],
    ["unpaired specifier", (w: any) => { w.result.files[0].edges[0].specifier = "./\ud800" }],
    ["NUL specifier", (w: any) => { w.result.files[0].edges[0].specifier = "./\0" }],
    ["negative edge", (w: any) => { w.result.files[0].edges[0].start = -1 }],
    ["empty edge", (w: any) => { w.result.files[0].edges[0].end = 14 }],
    ["outside edge", (w: any) => { w.result.files[0].edges[0].end = 100 }],
    ["fractional edge", (w: any) => { w.result.files[0].edges[0].start = 1.5 }],
    ["duplicate edge", (w: any) => { w.result.files[0].edges.push(w.result.files[0].edges[0]) }],
    ["erased initialization", (w: any) => { w.result.files[0].edges[0].typeOnly = true }],
    ["deferred static import", (w: any) => { w.result.files[0].edges[0].moduleInitialization = false }],
    ["type-only dynamic import", (w: any) => { Object.assign(w.result.files[0].edges[0], { kind: "dynamic-import", typeOnly: true, moduleInitialization: false }) }],
    ["require attributes", (w: any) => { Object.assign(w.result.files[0].edges[0], { kind: "require", attributes: true }) }],
    ["unknown edge field", (w: any) => { w.result.files[0].edges[0].symbol = {} }],
    ["missing resolution", (w: any) => { w.result.files[0].resolutions = [] }],
    ["different resolution", (w: any) => { w.result.files[0].resolutions[0].specifier = "./other" }],
    ["duplicate resolution", (w: any) => { w.result.files[0].resolutions.push(w.result.files[0].resolutions[0]) }],
    ["absolute resolution", (w: any) => { w.result.files[0].resolutions[0].runtimePath = "/outside.ts" }],
    ["escaping resolution", (w: any) => { w.result.files[0].resolutions[0].runtimePath = "../outside.ts" }],
    ["unnormalized resolution", (w: any) => { w.result.files[0].resolutions[0].runtimePath = "a/../outside.ts" }],
    ["backslash resolution", (w: any) => { w.result.files[0].resolutions[0].runtimePath = "a\\file.ts" }],
    ["drive resolution", (w: any) => { w.result.files[0].resolutions[0].runtimePath = "C:file.ts" }],
    ["missing paired path", (w: any) => { delete w.result.files[0].resolutions[0].typePath }],
    ["partial refused resolution", (w: any) => { w.result.files[0].resolutions[0].message = "refused" }],
    ["partial refused graph", (w: any) => { w.result.files[0].diagnostics = [{ start: 7, line: 2, column: 1, message: "refused" }] }],
    ["parser claims checking", (w: any) => { w.result.files[0].parseDiagnostics = [{ code: "TS2322", category: "error", message: "bad", file: "main.ts", span: { start: 0, length: 1 }, phase: "check" }] }],
    ["parser escapes source", (w: any) => { w.result.files[0].parseDiagnostics = [{ code: "TS1109", category: "error", message: "bad", file: "other.ts", span: { start: 0, length: 1 }, phase: "parse" }] }],
  ] as const) test(`rejects ${name}`, () => {
    const value = wire()
    mutate(value)
    expect(() => decode(value)).toThrow()
  })
})
