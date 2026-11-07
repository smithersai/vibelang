/** @throws {never} */
export function throwingValue(): { readonly value: number } { return { get value(): number { throw "t" } } }
