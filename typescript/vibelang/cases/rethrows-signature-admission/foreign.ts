export const sentinel = new RangeError("callback")
export const calls: number[] = []
/** @throws {RangeError} */
export function risky(): number { calls.push(1); throw sentinel }
/** @throws {never} */
export function safe(): number { return 7 }
export type Invoke = {
/** @throws {never} @rethrows cb */
(cb: () => number): number
}
export const invoke: Invoke = cb => cb()
/** @rethrows cb */
export type DocumentedAlias = (cb: () => number) => number
export const documented: DocumentedAlias = cb => cb()
