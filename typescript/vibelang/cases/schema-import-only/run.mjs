import assert from "node:assert/strict"
import * as Schema from "effect/Schema"
import { s, gone } from "./out/main.js"
import { code } from "./out/namespace.js"
import { missing } from "./out/error.js"
assert.equal(Schema.decodeUnknownSync(code)("a"), "a")
assert.equal(missing.id, "missing")
assert.deepEqual(Schema.decodeUnknownSync(s)({ id: "ok" }), { id: "ok" })
assert.equal(gone.id, "gone")
assert.equal(gone._tag, "Gone")
console.log("schema imports ok")
