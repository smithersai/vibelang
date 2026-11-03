import {Data, Effect} from "effect"
class Tagged extends Data.TaggedError("Tagged")<{message:string}> {}
const structural=Object.assign(new Error("structural"),{_tag:"Tagged" as const})
const broad:Error=structural
export function probe(){return Effect.gen(function*(){
const tagged:string[]=[]; const instance:string[]=[]
 for(const value of [new Tagged({message:"real"}),structural,new Error("untagged")] as ReadonlyArray<Tagged | typeof structural | (Error & {_tag?:undefined})>){
  const byTag = Effect.catchTag(Effect.fail(value), "Tagged", () => Effect.succeed("handled"))
  const byClass = Effect.catch(Effect.fail(value), e => e instanceof Tagged ? Effect.succeed("handled") : Effect.fail(e))
  const a = yield* Effect.exit(byTag); const b = yield* Effect.exit(byClass)
  tagged.push(a._tag==="Success" ? a.value : "propagated")
  instance.push(b._tag==="Success" ? b.value : "propagated")
 }
 return {tagged,instance,structuralIsError:broad instanceof Error}
})}
type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false
const success:Equal<Effect.Success<ReturnType<typeof probe>>,{tagged:string[];instance:string[];structuralIsError:boolean}>=true
const failure:Equal<Effect.Error<ReturnType<typeof probe>>,never>=true
const requirements:Equal<Effect.Services<ReturnType<typeof probe>>,never>=true
export const typeEvidence=[success,failure,requirements]
