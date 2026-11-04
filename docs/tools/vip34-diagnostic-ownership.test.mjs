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
import fc from "fast-check"
import {readFileSync} from "node:fs"
const read=name=>readFileSync(new URL("../../"+name,import.meta.url),"utf8")
test("using warning has VIP-34 ownership and the unchanged diagnostic exception",()=>{
 const vip=read("docs/design/vips/0034-compiler-and-tooling.md"),tooling=read("docs/design/src/007-tooling.md"),appendix=read("docs/design/src/900-appendices.md")
 checkWarningAuthority(vip)
 const row=appendix.split("\n").find(l=>l.startsWith("| "+String.fromCharCode(96)+"EK0801"))
 assert.ok(row);assert.match(row,/\| 34 \|/);assert.match(row,/acquireDisposable.*scoped/)
 const numbering=appendix.split("\n").find(l=>l.startsWith("Every diagnostic has"))
 assert.match(numbering,/EK08/);assert.match(numbering,/unchanged/)
 assert.match(tooling,/\| .using. in effect code \| .EK0801. \|/)
 const fence=String.fromCharCode(96).repeat(3)
 const configs=[...tooling.matchAll(new RegExp(fence+"jsonc?\\n([\\s\\S]*?)"+fence,"g"))].map(m=>m[1])
 assert.ok(configs.some(c=>c.includes('"vibe"')&&c.includes('"EK0801": "off"')))
})

const warningClauses = [
 "the native-resource warning belongs to VIP-34",
 "`using` in effect code has the default warning `EK0801`",
 "context-safe quick fix uses `acquireDisposable` inside `scoped`",
 "never changes TypeScript disposal or starts cleanup by itself",
 "not an imported Effect lint rule",
 "retained under the unchanged-code exception",
 "VIP-8's denial authorizes no language rule",
]
function checkWarningAuthority(vip) {
 const rule=vip.split("\n").find(line=>line.includes("the native-resource warning belongs to VIP-34"))
 assert.ok(rule,"missing public using-warning authority")
 for(const clause of warningClauses) assert.ok(rule.includes(clause),clause)
}
test("fast-check: warning ownership, disposal behavior and unchanged code remain required",()=>{
 const vip=read("docs/design/vips/0034-compiler-and-tooling.md")
 fc.assert(fc.property(fc.integer({min:0,max:warningClauses.length-1}),fc.stringMatching(/^[A-Za-z ]{0,50}$/),(index,prose)=>{
  checkWarningAuthority(prose+"\n"+vip+"\n"+prose)
  assert.throws(()=>checkWarningAuthority(vip.replace(warningClauses[index],"removed warning guarantee")),{code:"ERR_ASSERTION"})
 }),{seed:34008,numRuns:200})
})
