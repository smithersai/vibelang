import { Effect } from "effect"
import { program } from "./main.vibe"
const early=await Effect.runPromise(program())
if(early!==7)throw new Error("cyclic source consumer did not get 7")

