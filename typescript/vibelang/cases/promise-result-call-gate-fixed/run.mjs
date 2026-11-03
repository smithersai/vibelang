import { Cause, Effect } from "effect"
import { probe } from "./out/main.js"
import { sequence, defect, sentinel } from "./out/preserve.js"
const held = Effect.runSync(probe("", []))
if (!(held.p instanceof Promise) || !(held.q instanceof Promise) || !(held.tagged instanceof Promise) || held.optional !== undefined) throw new Error("Promise data was assimilated")
const result = Effect.runSync(sequence())
const exit = Effect.runSyncExit(defect())
const values = await Promise.all([result.a, result.b])
if (!(result.pending instanceof Promise) || !result.sameTemplate || values[0] !== 6 || values[1] !== 9 || result.events.join(",") !== "value:2,tag:2,value:3,tag:3" || exit._tag !== "Failure" || Cause.squash(exit.cause) !== sentinel) throw new Error("native preservation failed")
console.log(JSON.stringify(await Promise.all([held.p, held.q, held.tagged])))
