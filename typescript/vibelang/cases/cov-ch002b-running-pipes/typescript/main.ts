import { Effect, pipe } from "effect"
export function main(): Effect.Effect<unknown> {
 return Effect.gen(function* () {
 let evaluations = 0
 const object = { n: 7 }
 function input() { evaluations++; return object }
 const t = input()
 const same = t === object && t.n === 7
 const one = 1 + 1
 const t1 = 1; const t2 = t1 + 1; const chain = t2 * 2
 const nestedOuter = 1; const nestedInner = nestedOuter + 1; const nested = nestedInner * 2
 const branch = true ? 1 : 2 + 10
 const entireInput = true ? 1 : 2; const entire = entireInput + 10
 const identity = 7
 const xor = 1 ^ 3
 let assigned = 1; assigned ^= 3
 const modulo = 7 % 4
 const test = 1 ? 1 : 2
 const body = 1 ? 1 : 2
 const piped = pipe(2, n => n + 1)
 return [one,chain,nested,branch,entire,identity,same,xor,assigned,modulo,evaluations,test,body,piped]
 })
}
