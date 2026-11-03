import {Effect,Data,Schema} from "effect"
const customMatcher:unique symbol=Symbol.for("Symbol.customMatcher")
export function probe():readonly boolean[]{class E extends Data.TaggedError("E")<{readonly id:string}>{static [customMatcher](s:unknown):boolean{return typeof s==="object"&&s!==null&&"_tag" in s&&s._tag==="E"}};const D=Data.taggedEnum<Data.TaggedEnum<{A:{}}>>();const S=Schema.Struct({n:Schema.Number});return [Object.hasOwn(E,customMatcher),Object.hasOwn(D.A,customMatcher),Object.hasOwn(S,customMatcher)]}
export function main():Effect.Effect<readonly boolean[]>{return Effect.sync(probe)}
