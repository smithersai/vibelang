import assert from "node:assert/strict"
import { plain, encoded } from "./out/main.js"
assert.equal(plain._tag, "Plain")
assert.equal(encoded._tag, "Encoded")
console.log(JSON.stringify([plain.id, encoded.id]))
