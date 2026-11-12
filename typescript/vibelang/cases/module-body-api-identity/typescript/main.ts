/** Parse a port.
 * @throws {RangeError}
 */
export function port(raw: string): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new RangeError("bad port")
  return n
}
/** A parser with one nominal identity. */
export class Parser {
  private readonly brand = undefined
}
