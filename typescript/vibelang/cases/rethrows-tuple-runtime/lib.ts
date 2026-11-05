import {Effect} from "effect"
const order:string[]=[]
let calls=0
const failure=new RangeError("callback")
/** @throws {never} */
export function safe(n:number){calls++;order.push("safe");return n+1}
/** @throws {RangeError} */
export function risky(n:number):number{calls++;order.push("risky");throw failure}
/** @throws {never}
 * @rethrows cb
 */
export function invoke(cb:(n:number)=>number){order.push("invoke");return cb(7)}
export const safeTuple=[safe] as const
export const riskyTuple=[risky] as const
Object.defineProperty(safeTuple,Symbol.iterator,{value:function*(){order.push("iterate-safe");yield safe}})
Object.defineProperty(riskyTuple,Symbol.iterator,{value:function*(){order.push("iterate-risky");yield risky}})
export function inspect(program:Effect.Effect<number,unknown>){
 return Effect.map(Effect.exit(program),exit=>{
  if(exit._tag==="Success")return ["Success",exit.value]
  const reason=exit.cause.reasons[0]
  return [reason._tag,reason._tag==="Fail"&&reason.error===failure,calls,order]
 })
}
