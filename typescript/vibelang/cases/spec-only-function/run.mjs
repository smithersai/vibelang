// run-seconds: 120
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { proveWorkspace } from "../_vip43-prove.mjs"

const here = dirname(fileURLToPath(import.meta.url))
// The running program: count only.
const module = await import("./out/count.js")
console.log("exports: " + Object.keys(module).join(", "))
console.log("count([true, false, true, true]) = " + module.count([true, false, true, true]))
for (const file of ["out/count.js", "out/count.d.ts"]) {
  const text = readFileSync(join(here, file), "utf8")
  assert.ok(!text.includes("countPrefix"), file + " holds countPrefix")
  console.log(file + ": no countPrefix")
}
// The proof: count's ensures and invariants still name countPrefix.
const { project, prove, cleanup } = proveWorkspace(here)
try {
  const dir = project("count", { "count.vibe": readFileSync(join(here, "count.vibe"), "utf8") })
  const r = prove(dir)
  assert.equal(r.status, 0, r.text)
  console.log(r.text.trimEnd())
  console.log(readFileSync(join(dir, "proofs", "count.vibe.ts"), "utf8").trimEnd())
} finally {
  cleanup()
}
