import {Effect} from "effect"
export interface Reader<T> {
 /** @throws {T} */
 read(value:number):number
}
let calls=0
export const defect=new TypeError("callback defect")
export const reader:Reader<never>={read(value){calls++;return value*2}}
export const brokenReader:Reader<never>={read(value){calls++;throw defect}}
export function inspect(program:Effect.Effect<unknown>) {
 return Effect.map(Effect.exit(program),exit=>{
  if(exit._tag==="Success")return ["Success",exit.value] as const
  const reason=exit.cause.reasons[0]
  return [reason._tag,reason._tag==="Die"&&reason.defect===defect,calls] as const
 })
}
