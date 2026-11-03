import assert from "node:assert/strict"
import { Effect } from "effect"
import { main, unchecked, conditional, comma, call, arrow, methods, block } from "./out/main.js"
import { main as twin } from "./out/reference.js"
const actual = await Effect.runPromiseExit(main())
const expected = await Effect.runPromiseExit(twin())
assert.deepEqual(actual, expected)
const normalize = exit => exit._tag === "Success"
  ? ["Success", exit.value]
  : ["Failure", exit.cause.reasons.map(r => r._tag === "Die" ? ["Die", r.defect instanceof TypeError] : [r._tag])]
const operands = [() => 5, () => undefined, () => Promise.resolve(5), () => [],
  () => (function* () { return 7 })(), () => Effect.succeed(8),
  () => (function* () { return yield* Effect.succeed(9) })(),
  () => [Effect.succeed(10)], () => ({ [Symbol.iterator]: 1 })]
for (const fn of [unchecked, conditional, comma, call, arrow, value => methods.run(value), block]) {
  for (const make of operands) {
    const reference = Effect.gen(function* () { return yield* make() })
    assert.deepEqual(normalize(Effect.runSyncExit(fn(make()))), normalize(Effect.runSyncExit(reference)))
  }
}
console.log("same Exit")
