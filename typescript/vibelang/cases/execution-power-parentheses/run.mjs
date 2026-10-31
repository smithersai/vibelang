import { Effect } from "effect"
import { main } from "./out/main.js"
console.log(JSON.stringify(await Effect.runPromise(main())))
