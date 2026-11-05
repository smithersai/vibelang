import { Effect, Layer } from "effect"
import { Server, events } from "./out/main.js"
const construction = [...events]
await Effect.runPromise(Effect.scoped(Layer.build(Server)))
console.log(JSON.stringify({ construction, acquisition: events }))
