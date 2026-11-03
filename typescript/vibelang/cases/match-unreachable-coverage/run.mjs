import assert from "node:assert/strict"
import { Effect } from "effect"
import { main } from "./out/main.js"
import { mainTwin, takeEvents } from "./out/reference.js"
const value = await Effect.runPromise(main())
const events = takeEvents()
assert.equal(value, await Effect.runPromise(mainTwin()))
assert.deepEqual(events, takeEvents())
assert.deepEqual(events, ["e0"])
console.log(JSON.stringify({value, events}))
