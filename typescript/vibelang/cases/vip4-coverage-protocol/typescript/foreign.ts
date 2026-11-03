/** @throws {never} */
export function iterable(): Iterable<number> { return { [Symbol.iterator]() { return { next(): IteratorResult<number> { throw "iterator" } } } } }
