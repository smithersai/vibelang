// docs/design/vips/0034-compiler-and-tooling.md#c8a9f8f09355bffa
// VIP-34: the resolved retired Effect alias carries transition warning EK4856.
// run-seconds: 180
import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {dirname} from "node:path"
import {fileURLToPath} from "node:url"
import {compareTwin,exitView} from "../_cov-tooling-twin.mjs"
await compareTwin(import.meta.url,"main",[7,-2],async(fn,E,value)=>{const exit=await E.runPromiseExit(fn(E.succeed(value)));assert.equal(exit._tag,"Success");assert.equal(exit.value,value);return exitView(exit)})
const r=spawnSync(process.env.VIBELANG_BINARY,["-p",".","--noEmit","--pretty","false"],{cwd:dirname(fileURLToPath(import.meta.url)),encoding:"utf8",timeout:30000})
assert.ifError(r.error);assert.equal(r.status,0,r.stdout+r.stderr)
assert.match(r.stdout+r.stderr,/warning EK4856:/,"the resolved legacy alias must carry its transition diagnostic")
console.log("legacy alias transition warning")
