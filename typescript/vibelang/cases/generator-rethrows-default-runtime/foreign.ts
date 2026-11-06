export const events: string[] = []
export const sentinel = new RangeError("default")
/** @throws {RangeError} */
export function risky(): number { events.push("default"); throw sentinel }
/** @throws {never} @rethrows callback */
export function invoke<T>(callback: () => T): T { return callback() }
