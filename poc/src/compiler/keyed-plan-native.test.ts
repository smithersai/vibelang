import { beforeAll, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { getNativeCompiler, type NativeCompiler } from "./native.ts"
import type { NativeKeyedPlanRequest } from "./protocol.ts"

const oracle = JSON.parse(readFileSync(new URL("../../../compiler/testdata/keyed-plan-oracle.json", import.meta.url), "utf8"))
let native: NativeCompiler
beforeAll(() => { native = getNativeCompiler() }, 300_000)

for (const item of oracle.records) {
  test(`native keyed Plan SDK agrees with reference: ${item.name}`, () => {
    const request: NativeKeyedPlanRequest = { operation: item.operation, inputJson: JSON.stringify(item.input) }
    const result = native.keyedPlan(request)
    expect(result.ok).toBe(item.expected.ok)
    if (!result.ok) {
      expect(result.errorCode).toBe(item.expected.errorCode)
      expect(result.planJson).toBe("")
      expect(result.key).toBe("")
    } else if (item.operation === "derive-key") expect(result.key).toBe(item.expected.key)
    else {
      expect(JSON.parse(result.planJson)).toEqual(item.expected.plan)
      const checked = native.keyedPlan({ operation: "verify", inputJson: result.planJson })
      expect(checked.ok).toBe(true)
      expect(checked.planJson).toBe(result.planJson)
    }
  })
}

test("Plan identity ignores structural names and set order; approval binds the reviewed graph", () => {
  const plan = (name: string) => {
    const fixture = oracle.records.find((item: { name: string }) => item.name === name)
    const result = native.keyedPlan({ operation: "compile", inputJson: JSON.stringify(fixture.input) })
    expect(result.ok).toBe(true)
    return JSON.parse(result.planJson)
  }
  const a = plan("one"), renamed = plan("renamed-address"), priority = plan("priority")
  expect(a.nodes[0].key).toBe(renamed.nodes[0].key)
  expect(a.nodes[0].key).toBe(priority.nodes[0].key)
  expect(a.digest).not.toBe(renamed.digest)
  expect(a.digest).not.toBe(priority.digest)
  expect(plan("nfc-sets").nodes[0].key).toBe(plan("nfc-normal-sets").nodes[0].key)
  expect(native.keyedPlan({ operation: "verify", inputJson: JSON.stringify({ ...a, digest: priority.digest }) }).ok).toBe(false)
})
