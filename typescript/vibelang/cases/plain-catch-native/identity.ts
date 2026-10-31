// Throws for a value with no JSON form, as a schema projection can.
export const identity = (value: unknown): unknown => {
  if (value === "bad") throw new Error("no JSON representation")
  return value
}
