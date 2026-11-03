import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
const text = await readFile(new URL("./out/main.d.ts", import.meta.url), "utf8")
assert.match(text, /import \* as Ctx from "effect\/Context";/)
assert.match(text, /Ctx\.ServiceClass<Database,/)
const { Database, value } = await import("./out/main.js")
console.log(JSON.stringify([Database.key, value]))
