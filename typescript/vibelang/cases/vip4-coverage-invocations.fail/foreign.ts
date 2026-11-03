let calls = 0
let coerces = 0
/** @throws {never} */
export function reset() { calls = 0; coerces = 0 }
/** @throws {never} */
export function counts() { return [calls,coerces] }
export const api = { value: 6, async tag(parts: TemplateStringsArray, n: number) { calls++; return this.value + n + parts.length } }
export const specifier = { toString() { coerces++; throw "coercion" } }
