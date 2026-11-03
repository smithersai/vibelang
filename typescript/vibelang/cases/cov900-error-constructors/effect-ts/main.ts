// Chapter 900: cov900-error-constructors — independent Effect reference.
import {Data,Effect,Schema} from "effect"
class NotFound extends Data.TaggedError("NotFound")<{readonly id:string}>{}
type Delivery=Data.TaggedEnum<{Sent:{readonly tracking:string}}>
const Delivery=Data.taggedEnum<Delivery>()
class Invalid extends Schema.TaggedError<Invalid>()("Invalid",{name:Schema.NonEmptyString}){}
export function main(){return Effect.gen(function*(){
 const n=new NotFound({id:"x"});const d=Delivery.Sent({tracking:"y"})
 const invalid=yield* Effect.exit(Effect.gen(function*(){return yield* Effect.fail(new Invalid({name:""}))}))
 return [n.id,d.tracking,invalid._tag==="Failure"?invalid.cause.reasons[0]._tag:"unexpected"]
})}
