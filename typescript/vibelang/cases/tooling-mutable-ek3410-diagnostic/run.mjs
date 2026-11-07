// EK3410: each retired mutable marker on an ordinary interface or object-type
// property or index signature, or a plain error payload, is an error; members
// named mutable are not markers.
import assert from "node:assert/strict"
import { project, baseOptions } from "../_tooling-witness.mjs"

const sites = [
  ["export interface Box { mutable count: number }", 24],
  ["export interface Index { mutable [key: string]: number }", 26],
  ["export type Obj = { mutable name: string }", 21],
  ["export let inline: { mutable n: number } | undefined", 22],
  ["export error Failure { mutable value: number }", 24],
]
const controls = ["export interface Field { mutable: number }", "export interface Method { mutable(): number }", "export const mutable = 1"]
project(({ put, invoke }) => {
  put("tsconfig.json", { compilerOptions: { ...baseOptions(), noEmit: true }, files: ["main.vibe"] })
  put("main.vibe", [...sites.map(([line]) => line), ...controls].join("\n") + "\n")
  const result = invoke("-p", ".", "--pretty", "false")
  const found = result.text.split("\n").filter(line => / EK3410:/.test(line)).map(line => line.replace(/: .*$/, ""))
  assert.deepEqual(found, sites.map(([, column], i) => `main.vibe(${i + 1},${column}): error EK3410`), result.text)
  assert.notEqual(result.status, 0)
})
console.log("EK3410 rejects each retired ordinary mutable marker")
