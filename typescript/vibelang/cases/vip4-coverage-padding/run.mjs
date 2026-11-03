// rule-evidence: docs/design/vips/0004-throw.md#a9c5a9d5fa170785
// VIP-4: The inspected legacy annotation table already lists both padding methods
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as reference from "./typescript/out/main.js"
const a=Effect.runSyncExit(actual.main()),b=Effect.runSyncExit(reference.main())
assert.deepEqual(a,b)
assert.equal(a._tag,"Success")
assert.deepEqual(a.value,["x","x","00x","x00"])
const { entries }=JSON.parse(readFileSync(new URL("../../../../docs/design/inventory/throws.json",import.meta.url),"utf8"))
for (const name of ["String.padStart","String.padEnd"]) {
 const matches=entries.filter(e=>e.module==="global"&&e.declaration===name)
 assert.ok(matches.length)
 assert.ok(matches.every(e=>e.ownThrows==="never"),name)
}
console.log("padding: native ToLength results and never contracts")
