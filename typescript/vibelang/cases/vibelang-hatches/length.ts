// TypeScript keeps JavaScript's throw; Effect.try catches it.
export const lengthOf = (text: string): number => {
  if (text === "") throw new Error("empty")
  return text.length
}
