import { Effect } from "effect"
import { optionalRead, propertySamples } from "./native.js"
function isObject(value: unknown): value is object {
 return value!==null&&(typeof value==="object"||typeof value==="function")
}
function letRead(value: unknown) {
 const read=()=>cell
 if(!isObject(value))return ["miss"]
 if(!("cell" in value))return optionalRead(read)
 let cell=value.cell
 return optionalRead(read)
}
function constRead(value: unknown) {
 const read=()=>cell
 if(!isObject(value))return ["miss"]
 if(!("cell" in value))return optionalRead(read)
 const cell=value.cell
 return optionalRead(read)
}
function effectRead(value: unknown) {
 return Effect.gen(function*() {
  const read=()=>cell
  if(!isObject(value))return ["miss"]
  if(!("cell" in value))return optionalRead(read)
  let cell=value.cell
  return optionalRead(read)
 })
}
function isRead(value: unknown) {
 const read=()=>cell
 if(!isObject(value))return [false,optionalRead(read)]
 if(!("cell" in value))return [true,optionalRead(read)]
 let cell=value.cell
 return [true,optionalRead(read)]
}
function nestedRead(value: unknown) {
 const read=()=>cell
 if(!isObject(value)||!("outer" in value))return ["miss"]
 const inner=value.outer
 if(!isObject(inner))return ["miss"]
 if(!("cell" in inner))return optionalRead(read)
 let cell=inner.cell
 return optionalRead(read)
}
export function main() {
 return Effect.gen(function*() {
  const samples=propertySamples()
  return [
   [letRead(null),letRead({}),letRead({cell:2}),letRead({cell:undefined})],
   [constRead(0),constRead({}),constRead({cell:"x"}),constRead({cell:undefined})],
   [yield* effectRead(null),yield* effectRead({}),yield* effectRead({cell:2}),yield* effectRead({cell:undefined})],
   [isRead(null),isRead({}),isRead({cell:2}),isRead({cell:undefined})],
   [nestedRead({}),nestedRead({outer:{}}),nestedRead({outer:{cell:2}}),nestedRead({outer:{cell:undefined}})],
   [letRead(samples.ownGetter),constRead(samples.inherited)],
   yield* Effect.sync(() => samples.reads())
  ]
 })
}
