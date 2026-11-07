import assert from "node:assert/strict"
import { Classic, readModule } from "./out/main.js"
assert.equal(Classic.read(), "outer")
assert.equal(readModule(), "inner")
console.log("namespace closure and module scope")
