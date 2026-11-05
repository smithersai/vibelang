/** @throws {T} */
export function read<T>(): number {return 1}
/** @throws {T} */
export function defaultRead<T=never>(): number {return 2}
export interface Reader<T> {
 /** @throws {T} */
 read(): number
}
export const reader: Reader<never>={read:()=>3}
/** @throws {T} */
export function tag<T>(parts: TemplateStringsArray): number {return 4}
export class Box<T> {
 /** @throws {T} */
 constructor() {}
 readonly value=5
}
