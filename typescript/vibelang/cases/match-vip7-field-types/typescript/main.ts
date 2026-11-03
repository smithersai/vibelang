import {Effect} from "effect"
type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false
type Input={_tag:"Sent";tracking:string;id:number}|{_tag:"Other";id:number}
export function fields(s:Input):string{if(s._tag==="Sent"&&"tracking" in s&&"id" in s){const tracking=s.tracking;const exact:Equal<typeof tracking,string>=true;return tracking}return "other"}
export function guard(s:{n:string|number}):string{const n=s.n;if(typeof n==="string"){const exact:Equal<typeof n,string>=true;return n.toUpperCase()}return "other"}
export function main():Effect.Effect<readonly unknown[]>{return Effect.sync(()=>[fields({_tag:"Sent",tracking:"x",id:1}),fields({_tag:"Other",id:1}),fields({_tag:"Sent",tracking:"x"} as unknown as Input),guard({n:"x"}),guard({n:1})])}
