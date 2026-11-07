// EK1402: a legacy Effect data receiver method call is an error; native
// methods and namespace calls are outside the form.
import assert from "node:assert/strict"
import { project, baseOptions } from "../_tooling-witness.mjs"

const sites = [
  "export const mapped = Option.some(1).map(f)",
  "export const filtered = Option.some(3).filter((n: number) => n > 1)",
  "export const viaBinding = o.map(f)",
]
const controls = ["export const native = [1, 2].map(f)", "export const namespaced = Option.map(o, f)"]
project(({ put, invoke }) => {
  put("tsconfig.json", { compilerOptions: { ...baseOptions(), noEmit: true }, files: ["main.vibe"] })
  put("main.vibe", ["const f = (n: number) => n + 1", "const o = Option.some(1)", ...sites, ...controls].join("\n") + "\n")
  const result = invoke("-p", ".", "--pretty", "false")
  const found = result.text.split("\n").filter(line => / EK1402:/.test(line)).map(line => line.replace(/,\d+\): .*$/, ")"))
  assert.deepEqual(found, sites.map((_, i) => `main.vibe(${i + 3})`), result.text)
  assert.notEqual(result.status, 0)
})
console.log("EK1402 rejects each legacy data receiver method")
