export const sentinel=new RangeError("input")
export const events:string[]=[]
export const templates:boolean[]=[]
export const receivers:boolean[]=[]
let plainParts:TemplateStringsArray|undefined
let methodParts:TemplateStringsArray|undefined
/** @throws {never} */ export function safe():number {return 1}
/** @throws {RangeError} */ export function risky():number {events.push("risky");throw sentinel}
/** @throws {never} @rethrows cb */
export function first(this:void,cb:()=>number,other:()=>number):number {events.push("first");return cb()+other()}
/** @throws {never} @rethrows cb */
export function second(this:void,other:()=>number,cb:()=>number):number {events.push("second");return other()+cb()}
/** @throws {never} @rethrows cb */
export function tag(this:void,parts:TemplateStringsArray,cb:()=>number):number {
 templates.push(plainParts===undefined||plainParts===parts);plainParts=parts
 events.push("tag");return cb()
}
export const host={
 id:7,
 /** @throws {never} @rethrows cb */
 tag(this:{readonly id:number},parts:TemplateStringsArray,cb:()=>number):number {
  receivers.push(this===host)
  templates.push(methodParts===undefined||methodParts===parts);methodParts=parts
  events.push("method");return cb()
 }
}
