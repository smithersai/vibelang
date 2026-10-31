import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {readFileSync} from "node:fs"
import {fileURLToPath} from "node:url"
import {result} from "./out/main.js"
assert.deepEqual(result,Array(11).fill(true))
const compiler=fileURLToPath(new URL("../../../built/local/tsc",import.meta.url))
const checked=spawnSync(compiler,["-p",fileURLToPath(new URL("input/tsconfig.json",import.meta.url)),"--noEmit","--pretty","false"],{encoding:"utf8"})
assert.equal(checked.error,undefined)
const output=checked.stdout+checked.stderr
assert.notEqual(checked.status,0,output)
const rows=[...output.matchAll(/^.*[(]([0-9]+),[0-9]+[)]: error ([A-Z]+)([0-9]+):/gm)]
const expected=readFileSync(new URL("input/main.vibe",import.meta.url),"utf8").split("\n").flatMap((line,i)=>line.includes("// host-read")?[i+1]:[])
assert.equal(expected.length,5)
assert.equal(rows.length,5,output)
assert.deepEqual(rows.map(m=>Number(m[1])).sort((a,b)=>a-b),expected,output)
assert(rows.every(m=>m[2]==="EK"&&Number(m[3])===4402),output)
console.log("stable local aliases checked")
