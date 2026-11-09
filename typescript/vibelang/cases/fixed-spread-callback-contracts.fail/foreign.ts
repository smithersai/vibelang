export const sentinel=new RangeError("input")
export const events:string[]=[]
export const templates:boolean[]=[]
export const receivers:boolean[]=[]
export interface Allowed{
 /** @throws {unknown} */
 ():number
}
export interface Typed{
 /** @throws {RangeError} */
 ():number
}
/** @throws {never} */ export function safe():number{return 7}
/** @throws {RangeError} */ export function risky():number{events.push("risky");throw sentinel}
const input:[typeof risky]=[risky]
Object.defineProperty(input,"0",{get(){events.push("element");return risky}})
export const args:readonly[typeof risky]=input
/** @throws {never} */
export function admits(cb:Allowed):number{events.push("allowed");return cb()}
/** @throws {never} */
export function typed(cb:Typed):number{events.push("typed");return cb()}
/** @throws {never} @rethrows cb */
export function rethrows(cb:()=>number):number{events.push("rethrows");return cb()}
/** @throws {never} */
export function strict(cb:()=>number):number{return cb()}
export const host={
 id:7,
 /** @throws {never} */
 admits(this:{readonly id:number},cb:Allowed):number{
  receivers.push(this===host);events.push("method");return cb()
 }
}
