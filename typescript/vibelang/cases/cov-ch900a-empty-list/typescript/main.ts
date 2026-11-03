import { Effect } from "effect"
let reads = 0
function classify(xs: Iterable<number>) {
 const it = xs[Symbol.iterator]()
 const result = it.next()
 if (!result.done && it.return) it.return(undefined)
 return result.done ? 1 : 0
}
function sample(empty: boolean) {
 const source = { get [Symbol.iterator]() { reads++; return () => {
 let used = false
 return {
  next() {
   if (used || empty) return { done: true as const, value: undefined }
   used = true
   return { done: false as const, value: 1 }
  },
  return() { return { done: true as const, value: undefined } }
 }
} } }
 return classify(source)
}
export function main() {
  return Effect.gen(function* () { return [sample(true), sample(false), reads] 
  })
}
