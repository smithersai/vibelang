/** @throws {never} */
export function fromBinding(source: Iterable<number | undefined>) {
  for (const value of source) { if (value === undefined) return 9; return value }
  return 9
}
/** @throws {never} */
export function normalOrReturn(source: Iterable<number | undefined>, stop: boolean) {
  for (const value of source) { if (value === undefined) { if (stop) return 9; return 7 }; return value }
  return stop ? 9 : 7
}

/** @throws {never} */
export function annotated(source: (number | undefined)[], stop: boolean) {
  for (const value of source) { if (value === undefined) { if (stop) return 9; return 7 }; return value }
  return stop ? 9 : 7
}

/** @throws {never} */
export function neighboringDefault(source: [number | undefined, ((n: number) => number)?], stop: boolean) {
  const [value] = source
  if (value === undefined && stop) return 9
  const [, f = (n) => n] = source
  return f(6)
}
/** @throws {never} */
export function literalTuple(stop: boolean) {
  const [x = 7, y, ...rest] = [1, "s", true]
  if (x === undefined && stop) return 9
  return [x, y, rest] as const
}
