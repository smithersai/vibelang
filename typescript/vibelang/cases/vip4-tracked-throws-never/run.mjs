import { Cause, Effect, Exit } from "effect"
import { add, load, sum } from "./out/main.js"

const died = Effect.runSyncExit(sum())
const defect = Exit.isFailure(died) ? Cause.squash(died.cause) : undefined
console.log("add(1, 2):", add(1, 2))
console.log("sum died:", Exit.isFailure(died) && Cause.hasDies(died.cause), defect instanceof TypeError)
const failed = Effect.runSyncExit(load(""))
const error = Exit.isFailure(failed) ? Cause.squash(failed.cause) : undefined
console.log("load failed:", Exit.isFailure(failed) && !Cause.hasDies(failed.cause), error?._tag, JSON.stringify(error?.id))
