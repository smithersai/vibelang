/** @throws {Error} */
export function parse(s: string): string {
  if (s === "bad") throw new Error("bad")
  return s
}
/**
 * @throws {never}
 * @rethrows f
 */
export function invoke(f: () => string): string {
  return f()
}

export class Invoke {
  value: string
  /**
   * @throws {never}
   * @rethrows f
   */
  constructor(f: () => string) { this.value = f() }
}
