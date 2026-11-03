// VIP-39 EK39xx stays reserved for it: docs/design/vips/0039-vibex.md#a783d4c45fc3a6e3
import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {test} from "node:test"

test("VIP-39 keeps EK39xx reserved in the shipped diagnostic registry",()=>{
 const registry=readFileSync(new URL("../../typescript/tsc/internal/core/vibe_diagnostic_registry.go",import.meta.url),"utf8")
 assert.ok(registry.includes("VibeDiagnosticCategories"),"inspect the public registry, not an empty fixture")
 assert.deepEqual(registry.match(/"EK39[0-9][0-9]"/g)||[],[])
})
