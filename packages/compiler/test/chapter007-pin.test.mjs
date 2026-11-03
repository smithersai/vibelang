import assert from "node:assert/strict"
import {readFileSync} from "node:fs"
import {test} from "node:test"
const read=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),"utf8"))
// Chapter 007 / exact accepted Effect artifact and peer: docs/design/src/007-tooling.md#146f0ccbd93e9b91
// Chapter 007 / exact accepted Effect artifact and peer: docs/design/src/007-tooling.md#c6b61a86481bd880
test("Chapter 007 / compiler and runtime publish the same exact Effect peer",()=>{
 const compiler=read("../package.json"),runtime=read("../../runtime/package.json")
 assert.match(compiler.peerDependencies.effect,/^\d+\.\d+\.\d+$/)
 assert.equal(compiler.peerDependencies.effect,runtime.peerDependencies.effect)
 const installed=JSON.parse(readFileSync(new URL("../node_modules/effect/package.json",import.meta.url),"utf8"))
 assert.equal(installed.version,compiler.peerDependencies.effect)
})
