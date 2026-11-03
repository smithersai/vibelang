// TypeScript keeps JavaScript's throw.
export function checked(ok: boolean): string {
  if (!ok) throw new TypeError("invalid")
  return "valid"
}
