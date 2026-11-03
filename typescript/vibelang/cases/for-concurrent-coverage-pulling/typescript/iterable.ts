/** @throws {never} */
export function* items(log: string[]): IterableIterator<number> {
 try { for (let i=0;i<5;i++) { log.push("pull:"+i); yield i } }
 finally { log.push("close") }
}
