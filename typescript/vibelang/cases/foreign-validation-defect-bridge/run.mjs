import { Effect } from "effect"
import { validate, sentinel } from "./out/main.js"
const value = Effect.runSync(validate(false))
const exit = Effect.runSyncExit(validate(true))
const sameDefect = exit._tag === "Failure" &&
  exit.cause.reasons.length === 1 &&
  exit.cause.reasons[0]._tag === "Die" &&
  exit.cause.reasons[0].defect === sentinel
console.log(JSON.stringify({ value, sameDefect }))
