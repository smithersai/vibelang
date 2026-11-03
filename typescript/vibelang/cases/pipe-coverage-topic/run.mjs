import { checkStockTwin } from "../../test/coverage-stock-twins.mjs"
import fs from "node:fs"
import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { main as reference } from "./typescript/out/main.js"
const actual = await Effect.runPromiseExit(main())
const expected = await Effect.runPromiseExit(reference())
assert.deepEqual(actual, expected)
assert.equal(actual._tag, "Success")

checkStockTwin(import.meta.url, actual)
// VIP-23 pinned-snapshot: pair behavior with the vendored revision receipt.
const snapshot = fs.readFileSync(new URL("../../../../docs/design/vips/tc39-pipeline-operator/README.md", import.meta.url), "utf8")
assert.ok(snapshot.includes("5ac4dfd624e68b649e6f947885bf5ef67bac19f4"))
// VIP-31 small-shims: the pipe body lowers to ordinary temporaries/calls.
const pipeOutput = fs.readFileSync(new URL("./out/main.js", import.meta.url), "utf8")
assert.match(pipeOutput, /effect\/Effect/)
assert.doesNotMatch(pipeOutput.split("runtime.$entry")[0], /runtime[.]/)
console.log("coverage twins agree")
