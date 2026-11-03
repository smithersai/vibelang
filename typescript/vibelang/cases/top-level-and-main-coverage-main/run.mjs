import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {fileURLToPath} from "node:url"
import {checkTwin} from "../../test/coverage-twin.mjs"
const r=spawnSync(process.execPath,[fileURLToPath(new URL("out/main.js",import.meta.url))],{encoding:"utf8",timeout:60000})
assert.equal(r.status,0,r.stderr)
assert.equal(r.stdout,"","ordinary exported main was run implicitly")
checkTwin(fileURLToPath(new URL(".",import.meta.url)))
console.log("twin types and Exit agree")
