export const failure = new TypeError("hostile")
export const hostile = (n: number): number => {
  if (n === 0) throw failure
  return n
}
/** @vibelang trusted @throws {RangeError} */
export function bounded(n: number): number {
  if (n > 10) throw new RangeError("big")
  return n
}
/** @vibelang trusted @throws {SyntaxError} */
export function tagged(text: string): string {
  if (!text) throw new SyntaxError("tagged")
  return text
}
