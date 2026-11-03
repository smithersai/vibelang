import assert from "node:assert/strict"
import {readFile} from "node:fs/promises"
const dts=await readFile(new URL("./out/main.d.ts",import.meta.url),"utf8")
assert.equal(dts.includes("Database_shape"),false)
assert.equal(dts.includes("namespace Database"),false)
assert.equal(dts.includes("namespace Flags"),false)
const {Database,Flags}=await import("./out/main.js")
console.log(JSON.stringify([Database.key,Flags.key]))
