import { Effect } from "effect"
import {customArray,subclassArray,proxyArray,events} from "./helper.js"
const visit = (items: Iterable<number>) => Effect.runSync(Effect.catch(Effect.gen(function* () { for (const n of items) { yield* Effect.fail("boom") } }), () => Effect.sync(() => { events.push("caught") })))
visit(customArray())
console.log("array",events.join(","))
events.length=0
const iterable:Iterable<number>=customArray()
visit(iterable)
console.log("iterable",events.join(","))
events.length=0
visit(subclassArray())
console.log("subclass",events.join(","))
events.length=0
visit(proxyArray())
console.log("proxy",events.join(","))
