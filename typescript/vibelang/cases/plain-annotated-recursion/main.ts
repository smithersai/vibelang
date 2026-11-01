import { Effect } from "effect"
import { atLoad, countDown, isEven, sumTo } from "./recursion.vibe"
import { report } from "./report.vibe"

// TypeScript calls the plain functions directly.
console.log(sumTo(1000), isEven(1001), countDown(1000), atLoad)
console.log(JSON.stringify(await Effect.runPromise(report())))
