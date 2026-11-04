import { cpSync } from "node:fs"
import { Effect } from "effect"

// lib stands for a published package: its JavaScript sits beside out/main.js.
cpSync("lib", "out/lib", { recursive: true })
const m = await import("./out/main.js")
console.log(JSON.stringify(Effect.runSync(m.main())))
// Chapter 900: EK4818 diagnostic - spec-rule: docs/design/src/900-appendices.md#ef6ea2060cd56175
