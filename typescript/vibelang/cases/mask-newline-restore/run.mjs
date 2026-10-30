import * as Effect from "effect/Effect"
import { probe } from "./out/main.js"

const result = probe()
console.log(Effect.isEffect(result) ? await Effect.runPromise(result) : result)
