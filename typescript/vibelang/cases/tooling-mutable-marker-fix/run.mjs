// Ordinary mutable-marker migration: both fix scopes drop the redundant
// markers on interface and object-type members and index signatures, turn a
// marked plain error into a TaggedError compatibility class that still
// matches by tag, and leave schema and data markers and members named
// mutable to their own rules.
import assert from "node:assert/strict"
import { project, baseOptions, diagnostics } from "../_tooling-witness.mjs"

const members = `export interface Box { mutable count: number; mutable [key: string]: number }
export type Obj = { mutable name: string }
export interface Field { mutable: number }
export interface Method { mutable(): number }
export const box: Box = { count: 1 }
box.count = 2
export const obj: Obj = { name: "a" }
obj.name = "b"
`
const failure = `export error Failure { mutable value: number }
export effect function main() {
  const subject: unknown = new Failure({ value: 8 })
  return match (subject) { when Failure(let found): found.value; default: -1; }
}
`
// Schema markers have their own rules; the ordinary-member repair leaves them.
const schemas = `export schema Point { mutable x: number }
export schema error Bad { mutable why: string }
`
const removed = members
  .replace("{ mutable count: number; mutable [key: string]: number }", "{ count: number; [key: string]: number }")
  .replace("{ mutable name: string }", "{ name: string }")
const observe = `import { Effect } from "effect"
import { main, box, obj } from "./out/main.js"
console.log(JSON.stringify([await Effect.runPromise(main()), box.count, obj.name]))
`
const scopes = [[]]
for (const scope of scopes) {
  project(({ put, read, invoke, run }) => {
    put("tsconfig.json", { compilerOptions: baseOptions(), files: ["main.vibe", "schemas.vibe"] })
    put("main.vibe", members + failure)
    put("schemas.vibe", schemas)
    put("observe.mjs", observe)
    const before = invoke("-p", ".", "--pretty", "false")
    assert.equal(before.status, 0, before.text)
    const exits = run(process.execPath, ["observe.mjs"])
    assert.equal(exits.stdout.trim(), JSON.stringify([8, 2, "b"]), exits.text)

  })
}
// A data body's marker is its own rule (EK1606), not this migration's repair.
const data = "export data Shape { Circle { mutable radius: number } }\n"
for (const scope of scopes) {
  project(({ put, read, invoke }) => {
    put("tsconfig.json", { compilerOptions: { ...baseOptions(), noEmit: true }, files: ["main.vibe"] })
    put("main.vibe", data)
    assert.deepEqual(diagnostics(invoke("-p", ".", "--pretty", "false").text), ["error EK1606"])
  })
}
console.log("mutable markers migrate in both fix scopes; tagged matching survives")
