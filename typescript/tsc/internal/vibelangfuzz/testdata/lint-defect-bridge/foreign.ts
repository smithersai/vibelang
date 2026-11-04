export function predicate(value: unknown): value is Record<string, unknown> {
  if (value === null) throw value
  return typeof value === "object"
}
