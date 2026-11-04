/** @throws {Error} */
export function parse(s: string): string {
  if (s === "bad") throw new Error("bad")
  return s
}
