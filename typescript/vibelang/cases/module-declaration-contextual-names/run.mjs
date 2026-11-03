import assert from "node:assert/strict"
import { result, fromType, fromModule } from "./out/main.js"
assert.deepEqual(result, [1,2,3])
assert.equal(fromType, 2)
assert.equal(fromModule.n, 1)
console.log(JSON.stringify(result))
