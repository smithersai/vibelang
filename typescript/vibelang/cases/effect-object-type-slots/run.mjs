import { Effect } from "effect"
import { main } from "./out/main.js"
import { main as reference } from "./out/reference.js"
const actual = Effect.runSyncExit(main())
const expected = Effect.runSyncExit(reference())
if (JSON.stringify(actual) !== JSON.stringify(expected) || JSON.stringify(actual.value) !== "[1,2]") throw new Error("Effect object slot counterpart changed")
console.log("required object channels preserve exact types and legacy bodies")
