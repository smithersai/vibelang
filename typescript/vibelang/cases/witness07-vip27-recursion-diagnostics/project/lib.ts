export const foo = [1].map(function () { return foo })
export function recursive(n: number) { return n ? recursive(n - 1) : 1 }
export const ping = function () { return ping() }
export const builder = (value: string) => ({ value, named: (next: string) => builder(next) })
