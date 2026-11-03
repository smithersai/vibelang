import assert from "node:assert/strict"; import { n } from "./out/main.js"; import { n as native } from "./out/native.js"; assert.equal(n,native); assert.equal(n,1)
console.log("coverage-ok")
