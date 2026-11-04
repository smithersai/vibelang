import { Effect, Queue, Stream } from "effect"
function values(x:()=>number) {
 return Stream.callback<number>(queue=>Effect.gen(function*(){
  yield* Queue.offer(queue,x())
 }).pipe(Effect.andThen(Queue.end(queue))),{bufferSize:1,strategy:"suspend"})
}
class Counter {n=7;run(){return values(()=>this.n)}}
const counter=new Counter()
export const classMethod=()=>counter.run()
const object={n:11,run(){return values(()=>this.n)}}
export const objectMethod=()=>object.run()
class StaticCounter {static n=13;static run(){return values(()=>this.n)}}
export const staticMethod=()=>StaticCounter.run()
class PrivateCounter {n=17;#run(){return values(()=>this.n)};run(){return this.#run()}}
const privateCounter=new PrivateCounter()
export const privateMethod=()=>privateCounter.run()
export function noReceiver(){return values(()=>19)}
