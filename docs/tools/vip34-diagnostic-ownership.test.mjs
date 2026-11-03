// docs/design/vips/0034-compiler-and-tooling.md#b451bd4178495008
// VIP-34: published using-warning ownership, unchanged-code exception and configurable example.
// docs/design/vips/0034-compiler-and-tooling.md#eac5900ac04cd8b1
// VIP-34: published using-warning ownership, unchanged-code exception and configurable example.
// docs/design/vips/0034-compiler-and-tooling.md#4b60f5913e8facdc
// VIP-34: published using-warning ownership, unchanged-code exception and configurable example.
// docs/design/vips/0034-compiler-and-tooling.md#c2640b19e679bd8a
// VIP-34: published using-warning ownership, unchanged-code exception and configurable example.
import assert from "node:assert/strict"
import test from "node:test"
import {readFileSync} from "node:fs"
const read=name=>readFileSync(new URL("../../"+name,import.meta.url),"utf8")
test("using warning has VIP-34 ownership and the unchanged diagnostic exception",()=>{
 const vip=read("docs/design/vips/0034-compiler-and-tooling.md"),tooling=read("docs/design/src/007-tooling.md"),appendix=read("docs/design/src/900-appendices.md")
 assert.match(vip,/twelfth entry/)
 const row=appendix.split("\n").find(l=>l.startsWith("| "+String.fromCharCode(96)+"EK0801"))
 assert.ok(row);assert.match(row,/\| 34 \|/);assert.match(row,/acquireDisposable.*scoped/)
 const numbering=appendix.split("\n").find(l=>l.startsWith("Every diagnostic has"))
 assert.match(numbering,/EK08/);assert.match(numbering,/unchanged/)
 assert.match(tooling,/\| .using. in effect code \| .EK0801. \|/)
 const fence=String.fromCharCode(96).repeat(3)
 const configs=[...tooling.matchAll(new RegExp(fence+"jsonc?\\n([\\s\\S]*?)"+fence,"g"))].map(m=>m[1])
 assert.ok(configs.some(c=>c.includes('"vibe"')&&c.includes('"EK0801": "off"')))
})
