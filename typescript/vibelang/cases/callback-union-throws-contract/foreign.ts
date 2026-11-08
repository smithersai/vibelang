export type Allowed = {
/** @throws {unknown} */
(): number
}
export type Denied = {
/** @throws {never} */
(): number
}
type Fallback = { fallback: number }
export const events: string[] = []
export const caught: unknown[] = []
export const sentinel = new RangeError("sentinel")
/** @throws {RangeError} */
export function read(value: string): number {
  events.push(value)
  if (value === "") throw sentinel
  return Number(value)
}
function evaluate(input: Allowed | Fallback | undefined): number {
  try {
    if (input === undefined) return 0
    return typeof input === "function" ? input() : input.fallback
  } catch (error) {
    caught.push(error)
    return -1
  }
}
/** @throws {never} */
export function objectCall(input: Allowed | Fallback): number { return evaluate(input) }
/** @throws {never} */
export function optionalCall(input: Allowed | undefined): number { return evaluate(input) }
/** @throws {never} */
export function tupleCall(...args: [input: Allowed | Fallback]): number { return evaluate(args[0]) }
/** @throws {never} */
export function callableCall(input: Allowed | Denied): number { return evaluate(input) }
/** @throws {never} */
export function optionalParameterCall(input?: Allowed): number { return evaluate(input) }
