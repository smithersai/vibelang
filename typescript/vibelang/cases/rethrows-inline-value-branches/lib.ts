import * as Effect from "effect/Effect";
const marker=new SyntaxError("original");
const events:string[]=[];
/** @throws {SyntaxError} */
export function parse(broken:boolean):number{events.push("parse");if(broken)throw marker;return 7}
/** @throws {never}
 * @rethrows cb
 */
export function invoke(cb:()=>number):number{events.push("call");return cb()}
export class Runner{readonly value:number;
/** @throws {never}
 * @rethrows cb
 */
constructor(cb:()=>number){events.push("new");this.value=cb()}
}
/** @throws {never}
 * @rethrows cb
 */
export function tag(_parts:TemplateStringsArray,cb:()=>number):number{events.push("tag");return cb()}
export function verify(probes:readonly ((broken:boolean,choose:boolean)=>unknown)[]){
 return Effect.sync(()=>{
  let count=0,throws=0,successes=0;
  for(let index=0;index<probes.length;index++)for(const broken of [false,true])for(const choose of [false,true]){
   events.length=0;
   const selected=[choose,!choose,!choose,!choose,choose,true,choose,choose][index%8];
   const result=probes[index](broken,choose);
   const expected=broken&&selected?marker:selected?7:0;
   if(result!==expected)throw new Error("callback completion or identity changed at "+index);
   const phase=index<8?"call":index<16?"new":"tag";
   if(events.join(",")!==phase+(selected?",parse":""))throw new Error("callback invocation order changed at "+index);
   if(result===marker)throws++;else successes++;
   count++;
  }
  if(count!==96||throws!==27||successes!==69)throw new Error("incomplete callback matrix");
  return [count,throws,successes];
 })
}
