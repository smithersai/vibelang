import assert from "node:assert/strict"
import { cpSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { result, task } from "./out/main.js"
assert.deepEqual(result, [true,"41",true,true,3])
assert.equal(await Effect.runPromise(task()), 3)
const evidence = new URL("out/fix-evidence/", import.meta.url)
mkdirSync(evidence, {recursive:true})
cpSync(new URL("main.vibe", import.meta.url), new URL("main.vibe", evidence), {recursive:true, force:true})
cpSync(new URL("tsconfig.json", import.meta.url), new URL("tsconfig.json", evidence), {force:true})
const fixed = execFileSync(fileURLToPath(new URL("../../../built/local/tsc", import.meta.url)), ["-p", fileURLToPath(new URL("tsconfig.json", evidence)), "--fix", "--noEmit"], {encoding:"utf8"})
assert.match(fixed, /0 fixes in 0 files/)
console.log("explicit module imports preserved")
