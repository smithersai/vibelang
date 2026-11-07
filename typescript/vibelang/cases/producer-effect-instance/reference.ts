import { Effect as Eff, Fiber as Fib, Stream as Str, Queue as Q } from "effect"
function owns(owner:number,item:number) {
 return Eff.gen(function* () {
  const current=yield* Eff.fiberId
  const child=yield* Eff.forkChild(Eff.succeed(item))
  const okay=owner<current&&current<child.id
  yield* Fib.join(child)
  return okay
 })
}
function producer(owner:number, marker:()=>boolean=()=>true) {
 return Str.callback<boolean,never,never>(queue=>Eff.gen(function* () {
  for(const item of [1,2,3]) yield* Q.offer(queue,(yield* owns(owner,item))&&marker())
 }).pipe(Eff.andThen(Q.end(queue))),{bufferSize:1,strategy:"suspend"})
}
const declared=(owner:number)=>producer(owner)
const expression=(owner:number)=>producer(owner)
const object={marker:false,probeItems(owner:number){return producer(owner,()=>this.marker)}}
class Feed {
 marker=false
 probeItems(owner:number){return producer(owner,()=>this.marker)}
}
const feed=new Feed()
function streamFor(mode:number,owner:number) {
 object.marker=false
 feed.marker=false
 switch(mode) {
  case 0:return declared(owner)
  case 1:return expression(owner)
  case 2:return object.probeItems(owner)
  default:return feed.probeItems(owner)
 }
}
export function main() {
 return Eff.gen(function* () {
  const seen:boolean[]=[]
  for(const mode of [0,1,2,3]) {
   const anchor=yield* Eff.forkChild(Eff.gen(function* () {
    const owner=yield* Eff.fiberId
    const stream=streamFor(mode,owner)
    object.marker=true
    feed.marker=true
    return yield* Str.runCollect(stream)
   }))
   seen.push(...(yield* Fib.join(anchor)))
  }
  return seen
 })
}
