/** @throws {never} */
export function coercionKey(trace: string[], stop: object): any {
  return { [Symbol.toPrimitive]() { trace.push("coerce"); throw stop } }
}
