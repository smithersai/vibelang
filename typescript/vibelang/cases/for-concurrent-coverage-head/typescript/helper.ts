/** @throws {never} */
export function operand(read: () => number, trace: string[]): Iterable<number> {
 return { [Symbol.iterator]() {
  let done = false
  return { next(): IteratorResult<number> {
   if (done) return {done:true,value:undefined}
   done = true
   trace.push("pull")
   return {done:false,value:read()}
  } }
 } }
}
