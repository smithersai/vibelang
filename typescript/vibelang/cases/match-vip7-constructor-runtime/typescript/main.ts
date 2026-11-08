import { Effect } from "effect"
/** @throws {never} */
export function probe(value:unknown):string {
 class C {}
 const ctor=C as unknown as (s:unknown)=>readonly unknown[]|false
 const s=value==="instance"?new C():value
 try{const r=ctor(s);return r!==false&&r.length===0?"matched":"miss"}catch(e){return e instanceof TypeError?"TypeError":"other"}
}
export function main():Effect.Effect<readonly string[]>{return Effect.sync(()=>[probe("instance"),probe(null)])}
