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
export const args:ReadonlyArray<typeof risky>=input
/** @throws {never} */
export function admits(...callbacks:Allowed[]):number{events.push("allowed");return callbacks[0]()}
/** @throws {never} */
export function typed(...callbacks:Typed[]):number{events.push("typed");return callbacks[0]()}
/** @throws {never} @rethrows callbacks */
export function rethrows(...callbacks:(()=>number)[]):number{events.push("rethrows");return callbacks[0]()}
/** @throws {never} */
export function strict(...callbacks:(()=>number)[]):number{return callbacks[0]()}
export const host={
 id:7,
 /** @throws {never} */
 admits(this:{readonly id:number},...callbacks:Allowed[]):number{
  receivers.push(this===host);events.push("method");return callbacks[0]()
 }
}

export class AllowedBox {
 readonly value:number
 /** @throws {never} */
 constructor(...callbacks:Allowed[]) {events.push("constructor");this.value=callbacks[0]()}
}
