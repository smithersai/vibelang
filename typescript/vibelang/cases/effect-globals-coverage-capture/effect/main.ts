import { Effect } from "effect"
function query(n: number): Promise<number> { return Promise.resolve(n) }
export function main() {
 return Effect.gen(function*() {
  const n=7
  const a=yield* Effect.sync(()=>n)
  const b=yield* Effect.tryPromise(()=>query(n+1))
  const c=yield* Effect.callback<number>((resume)=>resume(Effect.succeed(n+2)))
  const d=yield* Effect.try(()=>n+3)
  const empty:undefined=undefined
  const matched=yield* Effect.match(Effect.succeed(n),{onFailure:()=>false,onSuccess:x=>x===n})
  return [a,b,c,d,empty===undefined,matched]
 })
}
