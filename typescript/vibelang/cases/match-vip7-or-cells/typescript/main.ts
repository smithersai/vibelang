type Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false
import { Effect } from "effect"
export function alternativeCell(): readonly number[] {
  const reads: (() => number)[] = []
  const subject = [1, 2]
  let n = subject[0]
  reads.push(() => n)
  n = subject.length
  return [n, reads[0]()]
}
export function main(): Effect.Effect<unknown> { return Effect.sync(()=>[alternativeCell(),alternativeType({a:2}),alternativeType({b:"x"})]) }

export function alternativeType(s:{a:number}|{b:string}):number|string{let n:number|string;if("a" in s)n=s.a;else n=s.b;const exact:Equal<typeof n,number|string>=true;return n}
