import { Effect, Data, Schema } from "effect"
const customMatcher:unique symbol=Symbol.for("Symbol.customMatcher")
export class E extends Data.TaggedError("E")<{readonly n:number}>{
 static [customMatcher](s:unknown,hint:{matchType:"boolean"|"extractor"}):boolean|readonly [unknown]{const ok=typeof s==="object"&&s!==null&&"_tag" in s&&s._tag==="E";return ok?(hint.matchType==="boolean"?true:[s]):false}
}
export class S extends Schema.TaggedError<S>()("S",{id:Schema.String}){
 static [customMatcher](s:unknown,hint:{matchType:"boolean"|"extractor"}):boolean|readonly [unknown]{const ok=typeof s==="object"&&s!==null&&"_tag" in s&&s._tag==="S";return ok?(hint.matchType==="boolean"?true:[s]):false}
}
export function read(x:unknown):unknown{if(typeof x==="object"&&x!==null&&"_tag" in x){if(x._tag==="E"&&"n" in x)return x.n;if(x._tag==="S"&&"id" in x)return x.id}return "other"}
export function main():Effect.Effect<readonly unknown[]>{return Effect.sync(()=>[read({_tag:"E",n:1}),read({_tag:"S",id:"x"}),read({})])}
