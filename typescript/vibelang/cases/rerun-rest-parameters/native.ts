import { Effect } from "effect"

export const compact=(...values:number[])=>Effect.gen(function*(){return values.pop()})
export const expanded=(...values:number[])=>Effect.gen(function*(){const last=values.pop();return last})
export function declared(...values:number[]){return Effect.gen(function*(){return values.pop()})}
export const expression=function(...values:number[]){return Effect.gen(function*(){return values.pop()})}
export class Counter {
  compact(...values:number[]){return Effect.gen(function*(){return values.pop()})}
  expanded(...values:number[]){return Effect.gen(function*(){const last=values.pop();return last})}
}
export const object={read(...values:number[]){return Effect.gen(function*(){return values.pop()})}}
export class Defaults {
  read(values:number[]=[1,2]){return Effect.gen(function*(){return values.pop()})}
  destructured({values=[1,2]}:{values?:number[]}={}){return Effect.gen(function*(){return values.pop()})}
}
export function declaredProgram(...values:number[]){return Effect.gen(function*(){return yield* Effect.succeed(values.pop())})}
export const fresh=(...values:number[])=>Effect.gen(function*(){return values})
