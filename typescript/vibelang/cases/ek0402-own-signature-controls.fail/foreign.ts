export function probe(path: string): string {
  if (path === "") throw new Error("empty")
  return path
}
export function other(path: string): string {
  return path
}
