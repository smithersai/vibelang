export class BadPort extends Error {
  readonly _tag = "BadPort"
}

/** @throws {BadPort} when the text is not a whole number */
export function parsePort(text: string): number {
  const n = Number(text)
  if (!Number.isInteger(n)) throw new BadPort(text)
  return n
}

/** @throws {never} */
export function double(n: number): number {
  return n * 2
}
