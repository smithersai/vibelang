import {Effect,Exit} from "effect"
export function main():Effect.Effect<unknown>{return Effect.gen(function*(){
 const exact:[Exit.Exit<number>,Exit.Exit<string>]=yield* Effect.all([Effect.exit(Effect.succeed(1)),Effect.exit(Effect.succeed("a"))],{concurrency:"unbounded"})
 const source=[...new Set([Effect.succeed(2)])]
 const spread:Exit.Exit<number>[]=yield* Effect.all(source.map(Effect.exit),{concurrency:"unbounded"})
 return [exact.map((e:Exit.Exit<number|string>)=>Exit.isSuccess(e)?e.value:"wrong"),spread.map(e=>Exit.isSuccess(e)?e.value:"wrong")]
})}
