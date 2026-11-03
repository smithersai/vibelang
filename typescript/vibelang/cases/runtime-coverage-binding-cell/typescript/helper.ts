/** @throws {never} */
export function values(hook: { read: () => number }, trace: string[]): Iterable<number | undefined> {
 return { [Symbol.iterator]() {
  return {
   next(): IteratorResult<number | undefined> {
    try { trace.push(String(hook.read())) } catch (e) { trace.push(e instanceof ReferenceError ? "tdz" : "other") }
    return {done:false,value:undefined}
   },
   return(): IteratorResult<number | undefined> { trace.push(String(hook.read())); return {done:true,value:undefined} }
  }
 } }
}
