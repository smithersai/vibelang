import { Effect } from "effect"
import { main } from "./out/main.js"
console.log("@@result " + JSON.stringify(await Effect.runPromise(main())))
