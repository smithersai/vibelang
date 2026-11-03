// Throws for a value with no JSON form, as a schema projection can.
export const identity = (value: unknown): unknown => {
  if (value === "bad") throw new Error("no JSON representation")
  return value
}

// JSON.parse, from TypeScript: its exception is JavaScript's.
export const parseJson = (text: string): unknown => JSON.parse(text)
