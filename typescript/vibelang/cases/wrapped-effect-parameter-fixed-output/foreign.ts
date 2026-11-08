export const events: string[] = []
export const sentinel = new RangeError("sentinel")
/** @throws {RangeError} */
export function read(text: string): number {
  events.push(text)
  if (text === "") throw sentinel
  return Number(text)
}
