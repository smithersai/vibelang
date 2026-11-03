// Chapter 900: cov900-declaration-controls — independent Effect reference.
import {Data,Effect,Schema} from "effect"
import {box} from "./helpers.js"
declare class Erased {readonly value:number}
declare const ambient:Erased
export type NativeAmbient=typeof ambient
class Missing extends Data.TaggedError("Missing"){}
const Item=Schema.Struct({["id"]:Schema.mutableKey(Schema.Number)})
const Alias=Item
class Fault extends Schema.TaggedError<Fault>()("Fault",{n:Schema.mutableKey(Schema.Number)}) {doubled(){return this.n*2}}
export {Item as default}
export function main(){return Effect.gen(function*(){
 const row=yield* Effect.try(()=>Schema.decodeUnknownSync(Alias)({id:3}))
 const accepted=yield* Effect.try(()=>Schema.is(box(Schema.Number))({value:1}))
 return [new Missing()._tag,new Fault({n:2}).doubled(),row.id,accepted]
})}
