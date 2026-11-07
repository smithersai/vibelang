// The same helper without a written throws contract.
export function parseOrZero(text: string): number {
  const n = Number(text)
  return Number.isNaN(n) ? 0 : n
}
