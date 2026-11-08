export const events: string[] = []
export const sentinel = new RangeError("sentinel")
/** @throws {RangeError} */
export function risky(value: string): number {
  events.push(value)
  if (value === "") throw sentinel
  return Number(value)
}
export const Fake = {
  try(callback: () => number): number { return callback() },
  tryPromise(callback: () => Promise<number>): Promise<number> { return callback() }
}
