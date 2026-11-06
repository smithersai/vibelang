export type Nil=never
export type Opaque=unknown
/** @throws {Nil} */
export function safe():number { return 7 }
export const sentinel = { code: "expected" }
/** @throws {unknown} */
export function risky(fail: boolean): number {
  if (fail) throw sentinel
  return 7
}
export type TextCallback = {
  /** @throws {Opaque} */
  (fail: boolean): number
}
/** @throws {never} @rethrows callback */
export function invoke(callback: TextCallback, fail: boolean): number {
  return callback(fail)
}
