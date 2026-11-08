export function probe(path: string): string {
  if (path === "") throw new Error("empty")
  return path
}
