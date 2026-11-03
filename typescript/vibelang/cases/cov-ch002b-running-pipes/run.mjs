import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { main as native } from "./typescript/out/main.js"
const observe = async f => JSON.parse(JSON.stringify(await Effect.runPromiseExit(f())))
assert.deepEqual(await observe(main), await observe(native))
assert.deepEqual(await Effect.runPromise(main()),[2,4,4,1,11,7,true,2,2,3,1,1,1,3])
console.log("pipe type and Exit parity")
