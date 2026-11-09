// rule-evidence: docs/design/src/004-match.md#exhaustiveness
import assert from "node:assert/strict"
import { area, complete } from "./out/main.js"

assert.equal(area({ kind: "circle", r: 2 }), Math.PI * 4)
assert.equal(complete({ kind: "square", side: 2 }), 2)
assert.throws(() => area({ kind: "square", side: 2 }), TypeError)
console.log("literal discriminant runtime unchanged")
