import { Effect } from "effect"
import { optionalRead } from "./native.js"
function letRead(value: readonly unknown[]) {
 const read = ()=>cell
 if (value.length>1) return ["miss"]
 if (value.length===0) return optionalRead(read)
 let cell=value[0]
 return optionalRead(read)
}
function constRead(value: readonly unknown[]) {
 const read = ()=>cell
 if (value.length>1) return ["miss"]
 if (value.length===0) return optionalRead(read)
 const cell=value[0]
 return optionalRead(read)
}
function effectRead(value: readonly unknown[]) {
 return Effect.gen(function*() {
  const read = ()=>cell
  if (value.length>1) return ["miss"]
  if (value.length===0) return optionalRead(read)
  let cell=value[0]
  return optionalRead(read)
 })
}
function isRead(value: readonly unknown[]) {
 const read = ()=>cell
 const matched=value.length<=1
 if (!matched) return ["miss"]
 if (value.length===0) return optionalRead(read)
 let cell=value[0]
 return optionalRead(read)
}
function nestedRead(value: readonly unknown[]) {
 const read=()=>cell
 if(value.length>1)return ["miss"]
 if(value.length===0)return optionalRead(read)
 const inner=value[0]
 if(!Array.isArray(inner)||inner.length>1)return ["miss"]
 if(inner.length===0)return optionalRead(read)
 let cell=inner[0]
 return optionalRead(read)
}
function elisionRead(value: readonly unknown[]) {
 const read=()=>cell
 if(value.length<2||value.length>3)return ["miss"]
 if(value.length===2)return optionalRead(read)
 let cell=value[2]
 return optionalRead(read)
}
export function main() {
 return Effect.gen(function*() {
  return [
   [letRead([]),letRead([2]),letRead([undefined]),letRead([1,2])],
   [constRead([]),constRead(["x"]),constRead([undefined]),constRead([1,2])],
   [yield* effectRead([]),yield* effectRead([2]),yield* effectRead([undefined]),yield* effectRead([1,2])],
   [isRead([]),isRead([2]),isRead([undefined]),isRead([1,2])],
   [nestedRead([]),nestedRead([[]]),nestedRead([[2]]),nestedRead([[undefined]])],
   [elisionRead([]),elisionRead([7,8]),elisionRead([7,8,2]),elisionRead([7,8,undefined])]
  ]
 })
}
