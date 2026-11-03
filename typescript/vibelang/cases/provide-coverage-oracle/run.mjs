import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {fileURLToPath} from "node:url"
const result=spawnSync(process.execPath,["--test",fileURLToPath(new URL("../../coverage-twin.test.mjs",import.meta.url))],{encoding:"utf8",timeout:60000})
assert.equal(result.status,0,result.stdout+result.stderr)
assert.match(result.stdout,/pass\s+5/)
assert.match(result.stdout,/skipped\s+0/)
console.log("twin oracle controls passed")
