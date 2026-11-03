import { Effect, Stream, Queue } from "effect"
function mixed() { return Stream.callback<number|string>(q => Effect.gen(function*(){yield* Queue.offer(q,1);yield* Queue.offer(q,"a")}).pipe(Effect.andThen(Queue.end(q))),{bufferSize:1,strategy:"suspend"}) }
const checked: Stream.Stream<number | string> = mixed()
function sequential(events:string[]) { return Stream.callback<number>(q=>Effect.gen(function*(){for(const n of [1,2,3,4]){events.push("offer"+n);yield* Queue.offer(q,n);events.push("done"+n)}}).pipe(Effect.andThen(Queue.end(q))),{bufferSize:1,strategy:"suspend"}) }
function concurrent(events:string[]) { return Stream.callback<number>(q=>Effect.forEach([1,2,3,4],n=>Effect.gen(function*(){events.push("offer"+n);yield* Queue.offer(q,n);events.push("done"+n)}),{concurrency:"unbounded",discard:true}).pipe(Effect.andThen(Queue.end(q))),{bufferSize:1,strategy:"suspend"}) }
export function main(): Effect.Effect<unknown> { return Effect.gen(function*(){
 const events:string[]=[]
 const sequentialValues=yield* Stream.runCollect(Stream.take(sequential(events),1))
 const concurrentValues=yield* Stream.runCollect(Stream.take(concurrent(events),1))
 return [yield* Stream.runCollect(checked),sequentialValues,concurrentValues,events]
}) }
