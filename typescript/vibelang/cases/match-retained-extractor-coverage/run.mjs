import * as Effect from "effect/Effect"
import * as Cause from "effect/Cause"
import * as M from "./out/main.js"
const run = value => Effect.isEffect(value) ? Effect.runSync(value) : value
console.log(JSON.stringify([M.describe(new M.Missing()), M.describe(new Cause.TimeoutError())].map(run)))
