import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {fileURLToPath} from "node:url"
import {result} from "./out/main.js"
assert.equal(result,7)
const compiler=fileURLToPath(new URL("../../../built/local/tsc",import.meta.url))
const checked=spawnSync(compiler,["-p",fileURLToPath(new URL("input/tsconfig.json",import.meta.url)),"--noEmit","--pretty","false"],{encoding:"utf8"})
assert.equal(checked.error,undefined)
const output=checked.stdout+checked.stderr
assert.notEqual(checked.status,0,output)
const rows=[...output.matchAll(/^.*[(]([0-9]+),[0-9]+[)]: error ([A-Z]+)([0-9]+):/gm)]
assert.equal(rows.length,3,output)
assert.deepEqual(rows.map(m=>Number(m[1])),[1,2,3],output)
assert(rows.every(m=>m[2]==="EK"&&Number(m[3])===4402),output)
console.log("type augmentation keeps host origins")
