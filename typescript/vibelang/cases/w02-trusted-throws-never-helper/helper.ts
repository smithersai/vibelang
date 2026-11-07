// A reviewed adapter: Number never throws for a string argument.
/** @throws {never} */
export function parseOrZero(text: string): number {
  const n = Number(text)
  return Number.isNaN(n) ? 0 : n
}
