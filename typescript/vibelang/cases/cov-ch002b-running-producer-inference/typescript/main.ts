import {Effect,Stream,Queue,Exit,Cause} from "effect"
import type {Scope} from "effect"
declare const scopeValue:Scope.Scope
declare const foreign:Stream.Stream<number,never,Scope.Scope>
export function empty(){return Stream.callback<never>(q=>Queue.end(q),{bufferSize:1,strategy:"suspend"})}
export function failed(){return Stream.callback<never,string>(q=>Effect.fail("typed").pipe(Effect.andThen(Queue.end(q))),{bufferSize:1,strategy:"suspend"})}
export function mixed(){return Stream.callback<string|number>(q=>Effect.gen(function*(){yield* Queue.offer(q,1);yield* Queue.offer(q,"a")}).pipe(Effect.andThen(Queue.end(q))),{bufferSize:1,strategy:"suspend"})}
export function scopeValueYield(){return Stream.callback<Scope.Scope>(q=>Queue.offer(q,scopeValue).pipe(Effect.andThen(Queue.end(q))),{bufferSize:1,strategy:"suspend"})}
export function ordinary(){return Effect.gen(function*(){yield* Effect.scope;return 7})}
export function foreignStream(){return foreign}
const emptyBack:ReturnType<typeof empty>=null as unknown as Stream.Stream<never>
const failedBack:ReturnType<typeof failed>=null as unknown as Stream.Stream<never,string>
const mixedBack:ReturnType<typeof mixed>=null as unknown as Stream.Stream<number|string>
const valueBack:ReturnType<typeof scopeValueYield>=null as unknown as Stream.Stream<Scope.Scope>
const ordinaryBack:ReturnType<typeof ordinary>=null as unknown as Effect.Effect<number,never,Scope.Scope>
const foreignBack:ReturnType<typeof foreignStream>=null as unknown as Stream.Stream<number,never,Scope.Scope>
export function main():Effect.Effect<unknown>{return Effect.gen(function*(){
 const a=yield* Stream.runCollect(empty())
 const b=yield* Effect.exit(Stream.runCollect(failed()))
 return [a,Exit.isFailure(b)?Cause.squash(b.cause):"wrong"]
})}
