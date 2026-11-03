import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { main as native } from "./out/native.js"
const actual = await Effect.runPromiseExit(main())
const reference = await Effect.runPromiseExit(native())
assert.deepEqual(actual, reference)
assert.equal(actual._tag, "Success")
assert.deepEqual(actual.value, {
  overloads: ["ok", 7], forms: [2, 3, 4, 5, 6],
  methods: [4, 8, 9, 5], cold: [[0, 0], 7, 7, 0, 2], decorations: ["mark"]
})
console.log("coverage-ok")
