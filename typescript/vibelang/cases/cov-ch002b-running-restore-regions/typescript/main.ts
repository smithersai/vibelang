import {Effect,Layer,Stream,Context} from "effect"
class Svc extends Context.Service<Svc,{n:number}>()("cov-ch002b-running-restore-regions/main#Svc"){}
function provided(){return Effect.uninterruptibleMask(restore=>Effect.provide(restore(Effect.gen(function*(){return (yield* Svc).n})),Layer.succeed(Svc,{n:1})))}
function forced(){return Effect.uninterruptibleMask(restore=>Effect.interruptible(restore(Effect.succeed(2))))}
function streamed(){return Effect.gen(function*(){let total=0;yield* Effect.uninterruptibleMask(restore=>Stream.runForEachWhile(Stream.make(3),n=>restore(Effect.sync(()=>{total+=n;return true}))));return total})}
export function main():Effect.Effect<unknown>{return Effect.gen(function*(){return [yield* provided(),yield* forced(),yield* streamed()]})}
