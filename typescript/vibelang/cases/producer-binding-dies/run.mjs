import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Stream from "effect/Stream"
import { array, defaulted, expression, object, plain, single } from "./out/main.js"

const describe = async thunk => {
  let value
  try {
    value = thunk()
  } catch (error) {
    return "Throw:" + error.constructor.name
  }
  const program = Stream.isStream(value) ? Stream.runCollect(value) : value
  const exit = await Effect.runPromiseExit(program)
  if (Exit.isSuccess(exit)) return "Success:" + JSON.stringify(exit.value)
  const reason = exit.cause.reasons[0]
  return reason._tag + ":" + (reason._tag === "Die" ? reason.defect.constructor.name + (reason.defect instanceof RangeError ? ":" + reason.defect.message : "") : String(reason.error))
}

const throwing = { get id() { throw new RangeError("getter") } }
let reads = 0
const counted = { get id() { reads++; return "x" } }

console.log("object undefined", await describe(() => object(undefined)))
console.log("object getter", await describe(() => object(throwing)))
console.log("object value", await describe(() => object({ id: "a" })))
console.log("array number", await describe(() => array(5)))
console.log("array value", await describe(() => array([4])))
console.log("default null", await describe(() => defaulted(1, null)))
console.log("default omitted", await describe(() => defaulted(1)))
console.log("expression undefined", await describe(() => expression(undefined)))
console.log("plain undefined", await describe(() => plain(undefined)))
console.log("single undefined", await describe(() => single(undefined)))
const stream = object(counted)
console.log("reads at the call", reads)
await describe(() => stream)
await describe(() => stream)
console.log("reads after two runs", reads)
console.log("lengths", object.length, array.length, defaulted.length, expression.length, plain.length)
