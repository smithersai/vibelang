import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
const dts = readFileSync(new URL("./out/main.d.ts",import.meta.url),"utf8")
assert.match(dts, /@throws \{never\}[\s\S]*SaveButton/)
assert.match(dts, /@throws \{never\}[\s\S]*Wrapped/)

console.log("VIP-39 PASS")
