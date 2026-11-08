// run-seconds: 120
import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {readFile,mkdir,writeFile,rm} from "node:fs/promises"
import {fileURLToPath} from "node:url"

const {observations} = await import("./out/main.js")
assert.deepEqual(observations,[1,2,3,4,10,20,30])
const text = await readFile(new URL("./out/main.d.ts",import.meta.url),"utf8")
assert.ok(text.includes("namespace Context"))
assert.ok(text.includes("marker = 10"))
const directory = new URL("./out/declaration-check/",import.meta.url)
await mkdir(directory,{recursive:true})
try {
  const source = new URL("main.ts",directory)
  await writeFile(source,text)
  const compiler = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../../built/local/tsc",import.meta.url))
  const result = spawnSync(compiler,["--noEmit","--target","ES2022","--module","NodeNext","--strict","--skipLibCheck","--pretty","false",fileURLToPath(source)],{encoding:"utf8",timeout:120000})
  assert.equal(result.error,undefined)
  assert.equal(result.signal,null)
  assert.equal(result.status,0,result.stdout+result.stderr)
} finally {
  await rm(directory,{recursive:true,force:true})
}
console.log("service declarations keep native qualifiers and authored namespace members")
