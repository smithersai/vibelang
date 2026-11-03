import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
const dts=readFileSync(new URL("./out/main.d.ts",import.meta.url),"utf8")
assert.match(dts,/function Wrapped\(\): JSX.Element/)
console.log("VIP-39 PASS")
