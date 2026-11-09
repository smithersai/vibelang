export const sentinel = new RangeError("spread")
export const events: string[] = []
/** @throws {RangeError} */
export function risky(): number { events.push("risky"); throw sentinel }
/** @throws {never} */
export function safe(): number { events.push("safe"); return 7 }
/** @throws {never} @rethrows callbacks */
export function many(...callbacks: (() => number)[]): number {
  let total = 0
  for (const callback of callbacks) total += callback()
  return total
}
