import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { decodeNativeKeyedPlan, NATIVE_API_VERSION, type NativeKeyedPlanRequest } from "./protocol.ts"

const revision = "1".repeat(40)
const request: NativeKeyedPlanRequest = { operation: "compile", inputJson: "null" }
const key = `key1_${"0".repeat(64)}`
const artifact = { planId: "test", flow: "test/Flow", generation: 0, baseDigest: key, digest: key, nodes: [] as unknown[] }
const success = () => ({ ok: true, planJson: JSON.stringify(artifact), key: "", errorCode: "", message: "" })
const decode = (result: unknown, input = request) => decodeNativeKeyedPlan(JSON.stringify({
  apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result,
}), revision, input)

test("keyed Plan transport distinguishes integrity, key derivation and refusals", () => {
  expect(decode(success()).ok).toBe(true)
  expect(decode({ ...success(), planJson: "", key }, { ...request, operation: "derive-key" }).key).toBe(key)
  expect(decode({ ok: false, planJson: "", key: "", errorCode: "invalid_plan", message: "altered graph" }).ok).toBe(false)
})

for (const [name, patch] of [
  ["non-boolean", { ok: "yes" }], ["false-success", { ok: false }], ["null-plan", { planJson: null }],
  ["empty-plan", { planJson: "" }], ["key-and-plan", { key }], ["partial-failure", { errorCode: "invalid_plan" }],
  ["success-message", { message: "refused" }], ["extra", { approved: true }], ["invalid-JSON", { planJson: "{" }],
  ["array", { planJson: "[]" }], ["null", { planJson: "null" }], ["primitive", { planJson: "1" }],
] as const) test(`keyed Plan protocol refuses ${name}`, () => { expect(() => decode({ ...success(), ...patch })).toThrow() })

for (const [name, patch] of [
  ["empty-id", { planId: "" }], ["empty-flow", { flow: "" }], ["generation", { generation: -1 }],
  ["fraction", { generation: 0.5 }], ["missing-generation", { generation: undefined }], ["new-generation-no-nodes", { generation: 1 }],
  ["bad-key-version", { digest: "key2_" + "0".repeat(64) }], ["bad-base", { baseDigest: key.toUpperCase() }],
  ["null-nodes", { nodes: null }], ["extra-artifact-field", { approved: true }], ["unsafe-unicode", { planId: "\ud800" }],
  ["too-many-nodes", { nodes: new Array(10001).fill(null) }], ["nested-lone-surrogate", { nodes: [{ body: "\ud800" }] }],
] as const) test(`keyed Plan envelope refuses ${name}`, () => { expect(() => decode({ ...success(), planJson: JSON.stringify({ ...artifact, ...patch }) })).toThrow() })

test("keyed Plan protocol enforces nested numeric and traversal budgets", () => {
  for (const body of ["-0", "1e400", "[".repeat(257) + "0" + "]".repeat(257)]) {
    const planJson = JSON.stringify(artifact).replace('"nodes":[]', `"nodes":[{"body":${body}}]`)
    expect(() => decode({ ...success(), planJson })).toThrow()
  }
})

test("keyed Plan protocol refuses missing fields, unknown errors, evidence on failure and version drift", () => {
  for (const field of Object.keys(success())) {
    const value: Record<string, unknown> = success(); delete value[field]
    expect(() => decode(value)).toThrow()
  }
  for (const patch of [{ errorCode: "unreviewed" }, { message: "" }, { key }, { planJson: "{}" }]) {
    expect(() => decode({ ok: false, planJson: "", key: "", errorCode: "invalid_plan", message: "refused", ...patch })).toThrow()
  }
  for (const patch of [{ apiVersion: NATIVE_API_VERSION - 1 }, { compilerRevision: "different" }]) {
    expect(() => decodeNativeKeyedPlan(JSON.stringify({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result: success(), ...patch }), revision, request)).toThrow()
  }
  expect(() => decode(success(), { ...request, operation: "execute" as never })).toThrow()
  expect(() => decode({ ...success(), planJson: "", key: "bad" }, { ...request, operation: "derive-key" })).toThrow()
})

test("every pinned oracle record fits the host response contract", () => {
  const oracle = JSON.parse(readFileSync(new URL("../../../compiler/testdata/keyed-plan-oracle.json", import.meta.url), "utf8"))
  expect(oracle.records).toHaveLength(141)
  for (const item of oracle.records) {
    const expected = item.expected
    const result = expected.ok ? { ok: true, planJson: expected.plan ? JSON.stringify(expected.plan) : "", key: expected.key ?? "", errorCode: "", message: "" } :
      { ok: false, planJson: "", key: "", errorCode: expected.errorCode, message: "reference refusal" }
    expect(decode(result, { operation: item.operation, inputJson: JSON.stringify(item.input) }).ok).toBe(expected.ok)
  }
})
