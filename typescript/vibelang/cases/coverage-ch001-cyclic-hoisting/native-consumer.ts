import { Effect } from "effect"
import { program } from "./native.js"
const early=await Effect.runPromise(program())
if(early!==7)throw new Error("cyclic native consumer did not get 7")

