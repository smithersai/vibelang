export type ForeignCallback<E> = {
/** @throws {E} */
(): number
}
export type ForeignPlain<Unused> = { (): number }

export interface ForeignPhantom<Unused> { (): number }

export interface ForeignMethod<E> {
/** @throws {E} */
load(): number
}
export interface ForeignGenericThrows<E> {
/** @throws {R} */
<R extends E>(): number
}
export interface ForeignNested<E> { nested: {
/** @throws {E} */
load(): number
} }
