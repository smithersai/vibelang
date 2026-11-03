import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { main as native } from "./typescript/out/main.js"
const observe = async f => JSON.parse(JSON.stringify(await Effect.runPromiseExit(f())))
assert.deepEqual(await observe(main),await observe(native))
assert.deepEqual(await Effect.runPromise(main()),["parse",6,["parse"],["parse","decode","handler"],5,["parse","handler"],5,7,9])
console.log("catch extent Exit parity")
