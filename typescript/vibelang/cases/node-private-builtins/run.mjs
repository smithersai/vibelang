import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { builtinModules, isBuiltin } from "node:module"
const names = ["_http_agent","_http_client","_http_common","_http_incoming","_http_outgoing","_http_server","_tls_common","_tls_wrap"]
assert(names.every(name => builtinModules.includes(name) && isBuiltin(name)))
const emitted = readFileSync(new URL("out/main.js", import.meta.url), "utf8")
assert(!emitted.includes("_http") && !emitted.includes("_tls") && !emitted.includes("_stream"), emitted)
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const checked = spawnSync(compiler, ["-p", fileURLToPath(new URL("input/tsconfig.json", import.meta.url)), "--noEmit", "--pretty", "false"], {encoding:"utf8"})
assert.equal(checked.error, undefined)
const output = checked.stdout + checked.stderr
assert.notEqual(checked.status, 0, output)
const rows = [...output.matchAll(new RegExp("^.*[(]([0-9]+),[0-9]+[)]: error ([A-Z]+)([0-9]+):", "gm"))]
assert.equal(rows.length, 28, output)
assert.deepEqual(rows.map(m=>Number(m[1])).sort((a,b)=>a-b), Array.from({length:28},(_,i)=>i+1), output)
assert(rows.every(m=>m[2]==="EK" && Number(m[3])===4402), output)
console.log("all Node builtin spellings checked")
