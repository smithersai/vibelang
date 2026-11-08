// run-seconds: 120
import assert from "node:assert/strict"
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { main } from "./out/main.js"

const original = main()
const expected = {
  chosen:["empty","empty","yes","miss"], defaults:["default","default","yes","miss"],
  nested:["nested","nested","nested","miss"], tags:["empty","empty","miss"],
  primitive:[3,0,-1], scope:"outerinnerfresh", writable:"new", inherited:"inherited", getter:"getter", reads:1,
  orderedResults:["miss","empty","empty","yes"],
  events:["miss","key","default","body","key","default","body","key","body"]
}
assert.deepEqual(original, expected)
const evidence = new URL("out/fix-evidence/", import.meta.url)
mkdirSync(evidence, {recursive:true})
const source = readFileSync(new URL("main.vibe", import.meta.url), "utf8")
writeFileSync(new URL("native.ts", evidence), source)
const native = await import(new URL("native.ts", evidence))
assert.deepEqual(native.main(), original, "native TypeScript and original VibeLang")
writeFileSync(new URL("main.vibe", evidence), source)
cpSync(new URL("tsconfig.json", import.meta.url), new URL("tsconfig.json", evidence))
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
console.log("native, original and fixed Match handlers agree")
