import { checkStockTwin } from "../../test/coverage-stock-twins.mjs"
import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { main as reference } from "./typescript/out/main.js"
const actual = await Effect.runPromiseExit(main())
const expected = await Effect.runPromiseExit(reference())
assert.deepEqual(actual, expected)
assert.equal(actual._tag, "Success")

checkStockTwin(import.meta.url, actual)
console.log("coverage twins agree")
