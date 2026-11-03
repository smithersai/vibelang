// run-seconds: 210
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { resolve,dirname } from "node:path"
import { fileURLToPath } from "node:url"
const here=dirname(fileURLToPath(import.meta.url))
const tsc=resolve(here,"../../../../docs/tools/node_modules/typescript/bin/tsc")
const native=spawnSync(process.execPath,[tsc,"-p",resolve(here,"reference")],{encoding:"utf8",timeout:180000})
assert.ifError(native.error)
assert.equal(native.status,0,native.stdout+native.stderr)
const dts = readFileSync(new URL("./out/main.d.ts", import.meta.url),"utf8")
const reference=readFileSync(new URL("./reference/out/main.d.ts",import.meta.url),"utf8")
const signatures=text=>text.replace(/\/\*[\s\S]*?\*\//g,"").replace(/\s+/g," ").trim()
assert.equal(signatures(dts),signatures(reference))
const contract = name => dts.slice(Math.max(0,dts.indexOf("export declare function "+name)-120),dts.indexOf("export declare function "+name))
assert.match(contract("fib"), /@throws \{never\}/)
for (const name of ["walk","even","odd","bounded","defaulted"]) assert.match(contract(name), /@throws \{Error\}/, name)
assert.match(contract("expand"), /@throws \{unknown\}/)
const actual = await import("./out/main.js")
assert.equal(actual.fib(6),8)
assert.equal(actual.defaulted(() => 7),7)
await assert.rejects(actual.asyncDefaulted(),/default/)
const asyncContract=dts.slice(dts.lastIndexOf("asyncDefaulted")-150)
assert.doesNotMatch(asyncContract,/@rethrows/)
assert.match(asyncContract,/@throws \{unknown\}/)
console.log("historical local throws inference and generated bounds")
