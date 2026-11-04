/** @throws {never} */
export function iterator(log: string[]) {
  return {
    [Symbol.iterator]() { return this },
    next() { return { done: false as const, value: 1 } },
    return(): IteratorResult<number> { log.push("close"); throw "closing" }
  }
}
