import { Effect } from "effect"

function regexOr(s:string) {
 const iterator=s.matchAll(/(a)/g)
 const first=iterator.next()
 if(!first.done&&iterator.next().done)return first.value[0]
 const second=s.match(/(b)/)
 return second===null?"miss":second[0]
}
function regexIs(s:string) {
 const iterator=s.matchAll(/(a)/g)
 const first=iterator.next()
 return !first.done&&iterator.next().done?first.value.index:-1
}
function run(kind:number,missFirst:boolean) {
 let calls=0
 function extractor(subject:unknown,_hint:{matchType:"boolean"|"extractor"}):number[]|false {
  calls++
  if(typeof subject!=="number" || (missFirst&&calls===1))return false
  return [subject+calls]
 }
 let values=extractor(10,{matchType:"extractor"})
 let matched=values!==false&&values.length===1
 if(kind===0) {
  let result=matched&&values!==false?values[0]:-1
  if(!matched){values=extractor(10,{matchType:"extractor"});if(values!==false&&values.length===1)result=values[0]}
  return [result,calls]
 }
 if(kind===1)return [matched?0:1,calls]
 return [matched,calls]
}
export function main():Effect.Effect<readonly unknown[]> {
 return Effect.succeed([regexOr("a"),regexOr("b"),regexOr("z"),regexIs("a"),regexIs("z"),run(0,false),run(0,true),run(1,false),run(1,true),run(2,false),run(2,true)])
}
