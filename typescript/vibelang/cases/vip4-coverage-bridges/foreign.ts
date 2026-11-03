let calls = 0
/** @throws {never} */
export function reset() { calls = 0 }
/** @throws {never} */
export function count() { return calls }
/** @throws {string} */
export function foreign(n: number): number { calls++; if (n < 0) throw "foreign"; return n }
export async function foreignAsync(n: number): Promise<number> { calls++; if (n < 0) throw "async"; return n }
