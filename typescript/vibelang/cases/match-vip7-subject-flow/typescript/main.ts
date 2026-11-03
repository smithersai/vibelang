import {Effect} from "effect"
type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false
type Input={_tag:"A";id:string|number}|{_tag:"B";value:number}
export function subject(s:"a"|"b"|1):"a"|"b"|1{if(s==="a"){const exact:Equal<typeof s,"a">=true;return s}if(s===1){const exact:Equal<typeof s,1>=true;return s}const exact:Equal<typeof s,"b">=true;return s}
export function guarded(s:Input):string{if(s._tag==="A"){const id=s.id;if(typeof id==="string")return id.toUpperCase()}const exact:Equal<typeof s,Input>=true;return s._tag}
export function main():Effect.Effect<readonly unknown[]>{return Effect.sync(()=>[subject("a"),subject("b"),subject(1),guarded({_tag:"A",id:"x"}),guarded({_tag:"A",id:1}),guarded({_tag:"B",value:1})])}
