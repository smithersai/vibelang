export const sentinel = { tag: "sentinel" }
/** @throws {never} */
export function getter(): { readonly value: number } { return { get value(): number { throw sentinel } } }
/** @throws {never} */
export function rejected(): Promise<never> { return Promise.reject(sentinel) }
