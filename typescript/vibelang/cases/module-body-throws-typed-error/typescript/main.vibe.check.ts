/** @throws {Error} */
export function nonEmpty(s: string): string {
  if (!s) throw new Error("empty")
  return s
}
