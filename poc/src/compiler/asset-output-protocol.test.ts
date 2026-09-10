import { expect, test } from "bun:test"
import { decodeNativeAssetOutput, NATIVE_API_VERSION } from "./protocol.ts"

const revision = "a".repeat(40)
const first = "0".repeat(64)
const last = "f".repeat(64)
const request = { source: "export default 1", declaredLogicalKeys: [last, first] }
const wire = () => ({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision,
  result: { ok: true, message: "", references: [first, last] } })

test("native asset output returns only sorted declared dependency keys", () => {
  expect(decodeNativeAssetOutput(JSON.stringify(wire()), revision, request)).toEqual(wire().result)
})
test("native asset output refuses code without publishing partial dependencies", () => {
  const result = { ok: false, message: "executable expression CallExpression", references: [] }
  expect(decodeNativeAssetOutput(JSON.stringify({ ...wire(), result }), revision, request)).toEqual(result)
})
for (const [name, mutate] of [
  ["wrong API", (w: any) => { w.apiVersion-- }],
  ["wrong revision", (w: any) => { w.compilerRevision = "b".repeat(40) }],
  ["missing references", (w: any) => { delete w.result.references }],
  ["null references", (w: any) => { w.result.references = null }],
  ["unsorted references", (w: any) => { w.result.references.reverse() }],
  ["duplicate references", (w: any) => { w.result.references = [first, first] }],
  ["undeclared reference", (w: any) => { w.result.references = ["a".repeat(64)] }],
  ["malformed key", (w: any) => { w.result.references = ["not-a-key"] }],
  ["nonstring key", (w: any) => { w.result.references = [42] }],
  ["surrogate repair", (w: any) => { w.result.ok = false; w.result.message = "\ud800"; w.result.references = [] }],
  ["success with refusal", (w: any) => { w.result.message = "refused" }],
  ["unexplained refusal", (w: any) => { w.result.ok = false; w.result.references = [] }],
  ["partial dependencies on refusal", (w: any) => { w.result.ok = false; w.result.message = "refused" }],
  ["unknown facts", (w: any) => { w.result.ast = {} }],
] as const) {
  test(`native asset output rejects ${name}`, () => {
    const value = wire()
    mutate(value)
    expect(() => decodeNativeAssetOutput(JSON.stringify(value), revision, request)).toThrow()
  })
}
