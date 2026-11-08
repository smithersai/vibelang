/** @throws {RangeError} */
export function key(fail: boolean): "value" {
  if (fail) throw new RangeError("key")
  return "value"
}
/** @throws {RangeError} */
export function decorator(fail: boolean): any {
  if (fail) throw new RangeError("decorator")
  return () => undefined
}
