export const sentinel = new RangeError("callback")
export const events: string[] = []
/** @throws {RangeError} */
export function risky(...args: unknown[]): number { events.push("risky"); throw sentinel }
/** @throws {never} */
export function safe(...args: unknown[]): number { events.push("safe"); return 7 }
