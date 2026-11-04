import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const declaration = readFileSync(new URL("./out/main.d.ts", import.meta.url), "utf8")
assert.equal((declaration.match(/@throws \{never\}/gu) ?? []).length, 16, declaration)
assert.ok(declaration.includes("Adds one."), declaration)
assert.ok(declaration.includes("@deprecated kept for compatibility"), declaration)
assert.ok(declaration.includes('export { foreign } from "./foreign.js"'), declaration)
console.log("every local non-Effect export keeps its generated throws contract")
