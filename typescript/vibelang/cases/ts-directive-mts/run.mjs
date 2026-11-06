import { Effect } from "effect"
import { main } from "./out/main.mjs"
console.log(await Effect.runPromise(main()))
