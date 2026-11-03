import assert from "node:assert/strict"
import { Effect } from "effect"
import { events } from "vip-events"
import { main } from "./out/main.js"
import { main as native } from "./typescript/out/main.js"

for (const program of [native, main]) {
 events.length = 0
 assert.equal(await Effect.runPromise(program()), "ReferenceError")
 assert.deepEqual(events, ["0", "item1"])
}
console.log("Stream head environment parity")
