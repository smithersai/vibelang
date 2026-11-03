export function skipped() {
  let n: number
  if (true || ((n = 1), true)) return n
  return 0
}
export function before() {
  const value = n
  let n = 1
  return value
}
export function immutable() {
  const n = 1
  n = 1
  return n
}
