import { expect, test } from "bun:test"
import { decodeNativeBodyLowering, NATIVE_API_VERSION, type NativeBodyLoweringRequest } from "./protocol.ts"

const revision = "a".repeat(40)
const request: NativeBodyLoweringRequest = { source: 'import { durable } from "vibelang:flows"; export const Flow = durable((n: number) => n + 1)',
  fileName: "flow.vibe", flowId: "flow.vibe#Flow", flowVersion: 1, runtimeImport: "vibelang/runtime", outputFileName: "/output/flow.body.ts" }
const wire = (): any => ({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result: {
  ok: true, reason: "", diagnostics: [], code: "export const Flow = (n: number) => n + 1;", entry: "Flow", async: false, resumable: false,
  entrySpan: { start: 60, length: 28 }, functionSpan: { start: 68, length: 19 }, derivedActions: [], errors: [],
  sourceMap: JSON.stringify({ version: 3, file: "flow.body.ts", sourceRoot: "", sources: [request.fileName], sourcesContent: [request.source], names: [], mappings: "AAAA" }),
  manifestJson: JSON.stringify({ manifestVersion: 1, flowId: request.flowId, flowVersion: 1, actions: [], requirements: [], contracts: [], failures: [], sites: [], digest: "a".repeat(64) }),
} })
const decode = (w: unknown) => decodeNativeBodyLowering(JSON.stringify(w), revision, request)
test("native body lowering carries explicit intermediate bytes and calling convention", () => {
  expect(decode(wire()).ok).toBe(true)
})
const changeMap = (change: (value: any) => void) => (w: any) => { const map = JSON.parse(w.result.sourceMap); change(map); w.result.sourceMap = JSON.stringify(map) }
const changeManifest = (change: (value: any) => void) => (w: any) => { const manifest = JSON.parse(w.result.manifestJson); change(manifest); w.result.manifestJson = JSON.stringify(manifest) }
for (const [name, change] of [
  ["old API", (w: any) => { w.apiVersion-- }],
  ["different revision", (w: any) => { w.compilerRevision = "b".repeat(40) }],
  ["missing result flag", (w: any) => { delete w.result.ok }],
  ["null result flag", (w: any) => { w.result.ok = null }],
  ["compiler object", (w: any) => { w.result.checker = {} }],
  ["missing diagnostics", (w: any) => { delete w.result.diagnostics }],
  ["null diagnostics", (w: any) => { w.result.diagnostics = null }],
  ["unknown reason", (w: any) => { w.result.reason = "fallback" }],
  ["unexplained refusal", (w: any) => { w.result.ok = false }],
  ["missing calling convention", (w: any) => { delete w.result.resumable }],
  ["null async", (w: any) => { w.result.async = null }],
  ["missing code", (w: any) => { delete w.result.code }],
  ["empty code", (w: any) => { w.result.code = "" }],
  ["missing entry", (w: any) => { delete w.result.entry }],
  ["missing entry span", (w: any) => { delete w.result.entrySpan }],
  ["null entry span", (w: any) => { w.result.entrySpan = null }],
  ["out-of-source function span", (w: any) => { w.result.functionSpan.start = 999 }],
  ["missing source content", changeMap(m => { delete m.sourcesContent })],
  ["changed source content", changeMap(m => { m.sourcesContent = ["different"] })],
  ["changed source identity", changeMap(m => { m.sources = ["other.vibe"] })],
  ["wrong output address", changeMap(m => { m.file = "other.body.ts" })],
  ["unmapped source identity", changeMap(m => { m.mappings = "ACAA" })],
  ["truncated VLQ", changeMap(m => { m.mappings = "g" })],
  ["invalid mapping fields", changeMap(m => { m.mappings = "AA" })],
  ["mapping outside source", changeMap(m => { m.mappings = "AAgBA" })],
  ["unknown manifest field", changeManifest(m => { m.plan = {} })],
  ["wrong Flow", changeManifest(m => { m.flowId = "other" })],
  ["wrong Flow version", changeManifest(m => { m.flowVersion++ })],
  ["missing sites", changeManifest(m => { delete m.sites })],
  ["null sites", changeManifest(m => { m.sites = null })],
  ["Action outside source", (w: any) => { w.result.derivedActions = [{name:"Read", id:"flow.vibe#Read", start:0, end:999}] }],
  ["wrong Action identity", (w: any) => { w.result.derivedActions = [{name:"Read", id:"other#Read", start:0, end:10}] }],
  ["unsorted Error identities", (w: any) => { w.result.errors = [{durable:"b",nominal:"b"},{durable:"a",nominal:"a"}] }],
  ["duplicate Error identities", (w: any) => { w.result.errors = [{durable:"a",nominal:"a"},{durable:"a",nominal:"a"}] }],
  ["error on success", (w: any) => { w.result.diagnostics = [{code:"VIBE4103",category:"error",phase:"lower",file:request.fileName,message:"bad",span:{start:0,length:1}}] }],
] as const) test(`native body lowering protocol rejects ${name}`, () => { const w = wire(); change(w); expect(() => decode(w)).toThrow() })

for (const reason of ["source", "entry", "boundary", "unsupported", "provenance"] as const) test(`native body lowering preserves ${reason} refusal without artifacts`, () => {
  const w = wire()
  Object.assign(w.result, { ok: false, reason, code: "", sourceMap: "", manifestJson: "", entry: "", entrySpan: null, functionSpan: null,
    diagnostics: [{code:"VIBE4103",category:"error",phase:"lower",file:request.fileName,message:"bad",span:{start:0,length:1}}] })
  expect(decode(w).reason).toBe(reason)
  w.result.resumable = true
  expect(() => decode(w)).toThrow()
})
