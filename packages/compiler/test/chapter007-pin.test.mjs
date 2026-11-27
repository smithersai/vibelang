import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {test} from "node:test"
const read=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),"utf8"))
// Chapter 007 / accepted Effect range and tested baseline: docs/design/vips/0032-effect-version.md
test("Chapter 007 / compiler and runtime publish the same Effect ^4.1.0 peer range and test on the baseline",()=>{
 const compiler=read("../package.json"),runtime=read("../../runtime/package.json")
 assert.match(compiler.peerDependencies.effect,/^\^4\.[1-9]\d*\.0$/)
 assert.equal(compiler.peerDependencies.effect,runtime.peerDependencies.effect)
 const installed=JSON.parse(readFileSync(new URL("../node_modules/effect/package.json",import.meta.url),"utf8"))
 assert.equal(installed.version,runtime.devDependencies.effect)
})
