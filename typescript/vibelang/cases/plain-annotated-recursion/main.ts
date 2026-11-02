import { Effect } from "effect"
import { atLoad, countDown, isEven, sumTo } from "./recursion.vibe"
import { report } from "./report.vibe"

// TypeScript calls the plain-annotated functions directly.
console.log(sumTo(100000), isEven(100001), countDown(100000), atLoad)
console.log(JSON.stringify(await Effect.runPromise(report())))
