export function iterated(value: never) { for (const item of value) {} }
export function arraySpread(value: never) { return [...value] }
export function abruptIteration() { return 5; for (const item of (undefined as never)) {} }
export function abruptSpread() { return 5; return [...(undefined as never)] }
export async function forAwait(value: never) { for await (const item of value) {} }
export function destructured(value: never) { const [item] = value; return item }
export function assigned(value: never) { let item: unknown; [item] = value; return item }
export function* delegated(value: never) { yield* value }
declare function take(...items: number[]): void
export function callSpread(value: never) { take(...value) }
