export interface Effect<A,E,R>{readonly "~effect/Effect":unknown;readonly value:number}
export type Value=Effect<number,never,never>
export const sentinel=new RangeError("marker")
export const events:string[]=[]
/** @throws {RangeError} */
export function make():Value {events.push("make");throw sentinel}
/** @throws {never} */
export function safe():Value {events.push("safe");return {"~effect/Effect":undefined,value:7}}
