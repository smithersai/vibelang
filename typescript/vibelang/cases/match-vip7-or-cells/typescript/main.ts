import { Effect } from "effect"
export function alternativeCell(): readonly number[] {
  const reads: (() => number)[] = []
  const subject = [1, 2]
  let n = subject[0]
  reads.push(() => n)
  n = subject.length
  return [n, reads[0]()]
}
export function main(): Effect.Effect<unknown> { return Effect.sync(alternativeCell) }

export function alternativeType(s:{a:number}|{b:string}):number|string{if("a" in s){const n=s.a;return n}const n=s.b;return n}
