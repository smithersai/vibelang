/** @throws {Error} */
export function failDefault(): string { throw new Error("default") }
// A generator's default runs at the call, so it throws there: this one is TypeScript.
export async function* generator(q = failDefault()): AsyncGenerator<string> { yield q }
