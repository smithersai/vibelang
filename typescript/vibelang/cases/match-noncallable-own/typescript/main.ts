import { Effect } from "effect"
import {capture,nativeCapture} from "./observe.js"
function witness(){
 try{
 const key=(Symbol as any).customMatcher ?? Symbol.for("Symbol.customMatcher")
 class C { static [key](subject:unknown,_hint?:unknown):false|unknown[]{return [subject]} }
 const holder={C}
 const subject=new C()
 const results:boolean[][]=[]
 for(const value of [null,false,0,1,"bad",{},[],undefined]){
  let reads=0
  Object.defineProperty(C,key,{configurable:true,get(){reads++;return value}})
  const operations=[()=>nativeCapture(C,subject,key),()=>nativeCapture(C,subject,key),()=>nativeCapture(C,subject,key),()=>nativeCapture(C,subject,key)]
  const row:boolean[]=[]
  for(const run of operations){
   reads=0
   const actual=run()
   const actualReads=reads
   reads=0
   const expected=nativeCapture(C,subject,key)
   row.push(actual===expected&&actualReads===1&&reads===1)
  }
  results.push(row)
 }
 return results
 }catch(e){return [["unexpected",(e as Error).name]]}
}
export function main(){return Effect.succeed(witness())}
