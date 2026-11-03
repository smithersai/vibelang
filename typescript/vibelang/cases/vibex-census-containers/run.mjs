import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as expected from "./typescript/out/main.js"
import { checkEffectTwin, normalizeEffects } from "../../test/census-vibex.mjs"
const a = Effect.runSyncExit(actual.main())
const b = Effect.runSyncExit(expected.main())
// Compare all observable values, including the cold Effect props and closure result.
function snapshot(exit) {
 assert.equal(exit._tag, "Success")
 const values = exit.value
 assert.equal(values[1].children[0], 0, "JSX must leave Effects cold")
 assert.equal(values[2].props.f(), 7, "topic crosses the arrow in a container")
 assert.equal(values.at(-1).children.at(-1), 1, "only the explicit try ran work")
 assert.ok(Effect.isEffect(values[0].props.onClick()), "an Effect handler returns a cold Effect")
 return normalizeEffects(Effect, values)
}
assert.deepEqual(snapshot(a), snapshot(b))
checkEffectTwin(import.meta.url, snapshot(a))

console.log("VIP-39 PASS")
