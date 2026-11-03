import {Effect} from "effect"
export function main():Effect.Effect<unknown>{return Effect.gen(function*(){
 const restore="visible"
 return yield* Effect.uninterruptibleMask(()=>Effect.gen(function*(){
 return [yield* Effect.uninterruptible(Effect.succeed(1)),yield* Effect.interruptible(Effect.succeed(2)),restore]
 }))
})}
