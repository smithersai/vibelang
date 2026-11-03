import { Effect } from "effect"
export function probe(value:unknown):string {
 class C {}
 const ctor=C as unknown as (s:unknown)=>readonly unknown[]|false
 const s=value==="instance"?new C():value
 try{if(s instanceof ctor)throw new TypeError();return "miss"}catch(e){return e instanceof TypeError?"TypeError":"other"}
}
export function main():Effect.Effect<readonly string[]>{return Effect.sync(()=>[probe("instance"),probe(null)])}
