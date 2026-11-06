import { Effect } from "effect"
import { main } from "./out/main.js"
console.log(await Effect.runPromise(main()))
