export const sentinel=new RangeError("input")
export const events:string[]=[]
export const templates:boolean[]=[]
export const receivers:boolean[]=[]
const partsByName=new Map<string,TemplateStringsArray>()
function remember(name:string,parts:TemplateStringsArray):void{
 templates.push(!partsByName.has(name)||partsByName.get(name)===parts)
 partsByName.set(name,parts)
 events.push(name)
}
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
/** @throws {never} */
export function admits(parts:TemplateStringsArray,cb:Allowed):number{remember("allowed",parts);return cb()}
/** @throws {never} */
export function typed(parts:TemplateStringsArray,cb:Typed):number{remember("typed",parts);return cb()}
/** @throws {never} @rethrows cb */
export function rethrows(parts:TemplateStringsArray,cb:()=>number):number{remember("rethrows",parts);return cb()}
/** @throws {never} */
export function strict(parts:TemplateStringsArray,cb:()=>number):number{return cb()}
export const host={
 id:7,
 /** @throws {never} */
 admits(this:{readonly id:number},parts:TemplateStringsArray,cb:Allowed):number{
  receivers.push(this===host);remember("method",parts);return cb()
 }
}
