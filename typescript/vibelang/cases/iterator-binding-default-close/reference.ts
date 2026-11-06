import { Effect } from "effect"
import {pairs,events} from "./helper.js"
const caught = (body: Effect.Effect<void, string>) => Effect.runSync(Effect.catch(body, () => Effect.sync(() => { events.push("caught") })))
caught(Effect.gen(function* () { for (const [n = yield* Effect.fail("boom")] of pairs()) { events.push("body:"+n) } }))
console.log("binding",events.join(","))
events.length=0
caught(Effect.gen(function* () { for (const pair of pairs()) { const [n = yield* Effect.fail("boom")] = pair; events.push("body:"+n) } }))
console.log("body",events.join(","))
