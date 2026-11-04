import * as Effect from "effect/Effect"
import { main } from "./out/main.js"
console.log(JSON.stringify(await Effect.runPromise(main())))
