export const events: string[] = []
/** @throws {never} */
export function reset(): void { events.length = 0 }
/** @throws {Error} */
export function parse(s: string): string {
  events.push("parse:" + s)
  if (s === "bad") throw new Error("bad")
  return s
}
/**
 * @throws {never}
 * @rethrows f
 */
export function tag<T>(_parts: TemplateStringsArray, f: () => T): T {
  events.push("tag")
  return f()
}
export const holder = {
  /**
   * @throws {never}
   * @rethrows f
   */
  tag<T>(_parts: TemplateStringsArray, f: () => T): T {
    events.push(this === holder ? "holder" : "lost")
    return f()
  }
}
