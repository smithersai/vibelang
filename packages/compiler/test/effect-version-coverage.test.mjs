import test from "node:test"
import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
test("VIP-32 compiler and runtime require the same exact Effect release",()=>{
 const c=JSON.parse(readFileSync(new URL("../package.json",import.meta.url)))
 const r=JSON.parse(readFileSync(new URL("../../runtime/package.json",import.meta.url)))
 assert.match(c.peerDependencies.effect,/^\d+\.\d+\.\d+$/)
 assert.equal(r.peerDependencies.effect,c.peerDependencies.effect)
})
// VIP-32 exact-peer-dependency-pin
// rule: docs/design/vips/0032-effect-version.md#1cc56090e3b485bb
// VIP-32 exact-peer-dependency-pin
// rule: docs/design/vips/0032-effect-version.md#d89942644af3abf9
// VIP-32 exact-peer-dependency-pin
// rule: docs/design/vips/0032-effect-version.md#9359896124660c28
