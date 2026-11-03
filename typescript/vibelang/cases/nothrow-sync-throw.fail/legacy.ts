// TypeScript keeps JavaScript's throw (control: no diagnostic).
export function legacy(text: string): string {
  if (text === "") throw new Error("empty")
  return text
}
