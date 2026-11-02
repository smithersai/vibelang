import assert from "node:assert/strict"
import { main } from "./out/main.js"
const expected = [7, null, 3, false, 3, false, 3, false, 3, true, 3, false, 7, false, 3, false, 3, true, "", "abc", "null", "undefined", 3, false, false, false, 3, true, true, [3, 3, "abc", 3, ["and", "and-body", "or", "or-body", "get", "call", "truthy-body"]], [false, true, "fallback", null, ["and", "or", "get", "nullish-body", "call"]], null, false, 3, false, "", "missing", 3, false, 3, true, 3, false, 3, true, "abc", 7, 3, false, 8, false]
assert.deepEqual(JSON.parse(JSON.stringify(main())), expected)
console.log("do narrowing: 51 branches passed")
