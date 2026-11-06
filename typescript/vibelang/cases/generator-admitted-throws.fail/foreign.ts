export const sentinel = new RangeError("sentinel")
export const events: string[] = []
/** @throws {RangeError} */
export function risky(): number {
  events.push("body")
  throw sentinel
}
export type Admitted<T> = {
  /** @throws {unknown} */
  (): T
}
/** @throws {never} */
export function accept<T>(f: Admitted<T>): T {
  events.push("accept")
  return f()
}
