/** @throws {RangeError} */
export function port(raw: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new RangeError(`bad port: ${raw}`)
  return n
}
