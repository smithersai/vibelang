import {Effect,Stream,Queue} from "effect"
class Parent{n=4;items(){return Stream.callback<number>(q=>Queue.offer(q,this.n).pipe(Effect.andThen(Queue.end(q))),{bufferSize:1,strategy:"suspend"})}}
class Child extends Parent{items(){const base=super.items();return Stream.callback<number>(q=>Stream.runForEachWhile(base,n=>Queue.offer(q,n+1).pipe(Effect.as(true))).pipe(Effect.andThen(Queue.end(q))),{bufferSize:1,strategy:"suspend"})}}
function target(){const t=new.target;return Stream.callback<boolean>(q=>Queue.offer(q,t===undefined).pipe(Effect.andThen(Queue.end(q))),{bufferSize:1,strategy:"suspend"})}
export function main():Effect.Effect<unknown>{return Effect.gen(function*(){return [yield* Stream.runCollect(new Child().items()),yield* Stream.runCollect(target())]})}
