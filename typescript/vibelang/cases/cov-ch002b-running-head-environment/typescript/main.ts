import {Effect,Cause,Exit} from "effect"
export function main():Effect.Effect<unknown>{return Effect.gen(function*(){
 const x=3;let read:()=>number=()=>0;const seen:number[]=[]
 const limit=x
 for(let x of (read=():number=>x,[1])){x=7;seen.push(x)}
 const a=yield* Effect.exit(Effect.try({try:()=>read(),catch:e=>e}))
 let readStream:()=>number=()=>0
 for(const x of (readStream=():number=>x,[1])){seen.push(x)}
 const b=yield* Effect.exit(Effect.try({try:()=>readStream(),catch:e=>e}))
 const name=(ex:Exit.Exit<unknown,unknown>)=>Exit.isFailure(ex)?(Cause.squash(ex.cause) as Error).name:"wrong"
 return [seen,name(a),name(b)]
})}
