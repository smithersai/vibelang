// TypeScript keeps JavaScript's throw.
export function halt(): never {
  throw new Error("stop")
}
