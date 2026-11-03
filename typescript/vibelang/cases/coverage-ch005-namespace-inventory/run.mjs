import assert from "node:assert/strict"
import * as actual from "./out/main.js"
import * as native from "./out/native.js"
assert.deepEqual(actual.roots,native.roots)
assert.deepEqual(actual.roots,native.subpaths)
assert.deepEqual(actual.namespaces,native.namespaces)
assert.equal(actual.namespaces.length,25)
