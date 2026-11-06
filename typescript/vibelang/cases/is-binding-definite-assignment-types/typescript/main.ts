// VIP-7 array patterns extract iterable elements; an open subject supplies unknown.
export function read(s: unknown) {
  let value: unknown
  if (Array.isArray(s) && s.length === 2 && s[0] === 1 && (value = s[1], true)) return value
  return value
}
export function optional(s: [number, number | undefined]) {
  let value: number | undefined
  if (s[0] === 1 && (value = s[1], true)) return value
  return value
}
export function checked(s: [number, number]) {
  let value: number
  if (!(s[0] === 1 && (value = s[1], true))) return
  return value
}
