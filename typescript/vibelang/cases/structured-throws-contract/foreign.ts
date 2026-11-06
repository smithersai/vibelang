export const sentinel = { code: "expected" }
/** @throws {{readonly code:string}} */
export function risky(fail: boolean): number {
  if (fail) throw sentinel
  return 7
}
export type TextCallback = {
  /** @throws {{readonly code:string}} */
  (fail: boolean): number
}
/** @throws {never} @rethrows callback */
export function invoke(callback: TextCallback, fail: boolean): number {
  return callback(fail)
}
