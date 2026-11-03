import { Effect } from "effect"
import { invalid } from "./out/a.js"
console.log(await Effect.runPromise(invalid("8")))
