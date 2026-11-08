import * as Effect from"effect/Effect";
const marker=new SyntaxError("original");
const events:string[]=[];
/** @throws {SyntaxError} */
export function parse(broken:boolean):number{events.push("parse");if(broken)throw marker;return 7}
/** @throws {never} */
export function argument():number{events.push("prefix");return 1}
/** @throws {never} */
export function safe():number{events.push("safe");return 0}
/** @throws {never}
 * @rethrows cb
 */
export function higher(cb:()=>number):number{events.push("call");return cb()}
/** @throws {never}
 * @rethrows cb
 */
export function after(prefix:number,cb:()=>number):number{events.push("after:"+prefix);return cb()}
/** @throws {never}
 * @rethrows callbacks
 */
export function many(...callbacks:(()=>number)[]):number{events.push("many");let value=0;for(const cb of callbacks)value=cb();return value}
/** @throws {never}
 * @rethrows cb
 */
export function optional(cb?:()=>number):number{events.push("optional");return cb?cb():0}
export class Runner{readonly value:number;
/** @throws {never}
 * @rethrows cb
 */
constructor(cb:()=>number){events.push("new");this.value=cb()}
}
export function verify(probes:readonly ((broken:boolean)=>unknown)[]){
 return Effect.sync(()=>{
  let count=0,throws=0,successes=0;
  for(let index=0;index<probes.length;index++)for(const broken of [false,true]){
   events.length=0;const result=probes[index](broken);const shape=Math.floor(index/2);
   if(result!==(broken?marker:7))throw new Error("tuple callback completion or identity changed at "+index);
   const wanted=[3,4,8,9].includes(shape)?"prefix,after:1,parse":shape===5?"many,safe,parse":shape===6?"new,parse":shape===7?"optional,parse":"call,parse";
   if(events.join(",")!==wanted)throw new Error("tuple argument or invocation order changed at "+index);
   if(result===marker)throws++;else successes++;count++;
  }
  if(count!==40||throws!==20||successes!==20)throw new Error("incomplete tuple callback matrix");
  return[count,throws,successes];
 })
}
