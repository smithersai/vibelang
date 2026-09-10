import { describe, expect, test } from "bun:test"
import { decodeNativeAssetImports, NATIVE_API_VERSION } from "./protocol.ts"

const revision = "a".repeat(40)
const request = { files: [{ path: "main.vibe", text: '// 🐱\r\nimport data from "./data.json" with {type:"json"};' }], resolutionRoot: "/project" }
const wire = () => ({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result: { files: [{
  path: "main.vibe", diagnostics: [] as unknown[], ordinaryImports: [] as unknown[], requests: [{
    specifier: "./data.json", attributes: { type: "json" }, form: "import",
    site: { start: 7, line: 2, column: 1 }, specifierSite: { start: 24, line: 2, column: 18 },
  }],
}] } })

describe("native asset import protocol", () => {
  test("returns authored positions and selected attributes", () => {
    expect<unknown>(decodeNativeAssetImports(JSON.stringify(wire()), revision, request)).toEqual(wire().result)
  })
  test("permits in-root native resolutions only under explicit authority", () => {
    const value = wire()
    value.result.files[0]!.ordinaryImports = [{ specifier: "./helper", resolvedPath: "helper.ts" }]
    expect<unknown>(decodeNativeAssetImports(JSON.stringify(value), revision, request).files[0]!.ordinaryImports).toEqual(value.result.files[0]!.ordinaryImports)
    expect(() => decodeNativeAssetImports(JSON.stringify(value), revision, { files: request.files })).toThrow()
  })
  test("a refused file returns no partial module authority", () => {
    const value = wire()
    value.result.files[0]!.requests = []
    value.result.files[0]!.diagnostics = [{ code: "VIBE5201", severity: "error", message: "missing type", fileName: "main.vibe", line: 2, column: 1 }]
    expect(decodeNativeAssetImports(JSON.stringify(value), revision, request).files[0]!.diagnostics).toHaveLength(1)
  })
  for (const [name, mutate] of [
    ["wrong API", (w: any) => { w.apiVersion-- }],
    ["wrong revision", (w: any) => { w.compilerRevision = "b".repeat(40) }],
    ["missing file", (w: any) => { w.result.files = [] }],
    ["foreign file", (w: any) => { w.result.files[0].path = "other.vibe" }],
    ["unknown AST", (w: any) => { w.result.files[0].ast = {} }],
    ["null requests", (w: any) => { w.result.files[0].requests = null }],
    ["unselected loader", (w: any) => { w.result.files[0].requests[0].attributes = {} }],
    ["blank loader", (w: any) => { w.result.files[0].requests[0].attributes.type = "  " }],
    ["dynamic attribute", (w: any) => { w.result.files[0].requests[0].attributes.type = {} }],
    ["invalid attribute name", (w: any) => { w.result.files[0].requests[0].attributes["x.y"] = "json" }],
    ["unpaired attribute", (w: any) => { w.result.files[0].requests[0].attributes.note = "\ud800" }],
    ["bare asset", (w: any) => { w.result.files[0].requests[0].specifier = "data" }],
    ["nul specifier", (w: any) => { w.result.files[0].requests[0].specifier = "./data\0" }],
    ["unpaired specifier", (w: any) => { w.result.files[0].requests[0].specifier = "./\ud800.json" }],
    ["invented form", (w: any) => { w.result.files[0].requests[0].form = "require" }],
    ["duplicate site", (w: any) => { w.result.files[0].requests.push(w.result.files[0].requests[0]) }],
    ["mismatched offset", (w: any) => { w.result.files[0].requests[0].site.start++ }],
    ["escaped line", (w: any) => { w.result.files[0].requests[0].site.line = 3 }],
    ["escaped column", (w: any) => { w.result.files[0].requests[0].site.column = 300 }],
    ["fractional position", (w: any) => { w.result.files[0].requests[0].site.column = 1.5 }],
    ["specifier before statement", (w: any) => { w.result.files[0].requests[0].specifierSite = {start:0,line:1,column:1} }],
    ["partial failure facts", (w: any) => { w.result.files[0].diagnostics = [{}] }],
    ["duplicate ordinary edge", (w: any) => { w.result.files[0].ordinaryImports = [{specifier:"./x"},{specifier:"./x"}] }],
    ["unsorted ordinary edges", (w: any) => { w.result.files[0].ordinaryImports = [{specifier:"./z"},{specifier:"./a"}] }],
    ["bare ordinary edge", (w: any) => { w.result.files[0].ordinaryImports = [{specifier:"node:fs"}] }],
  ] as const) {
    test(`refuses ${name}`, () => {
      const value = wire()
      mutate(value)
      expect(() => decodeNativeAssetImports(JSON.stringify(value), revision, request)).toThrow()
    })
  }
  for (const resolvedPath of ["/absolute.ts", "../outside.ts", "a/../outside.ts", "a\\file.ts", "C:/file.ts", "", "./file.ts", "a//file.ts", "nul\0.ts", "\ud800.ts"]) {
    test(`refuses invalid resolved path ${JSON.stringify(resolvedPath)}`, () => {
      const value = wire()
      value.result.files[0]!.ordinaryImports = [{ specifier: "./helper", resolvedPath }]
      expect(() => decodeNativeAssetImports(JSON.stringify(value), revision, request)).toThrow()
    })
  }
})
