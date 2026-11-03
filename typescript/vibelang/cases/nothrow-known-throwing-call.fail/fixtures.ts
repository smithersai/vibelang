/** @vibelang trusted @throws {SyntaxError} */
export function tagged(text: string): string {
  if (!text) throw new SyntaxError("tagged")
  return text
}

// No contract: its throwing is unknown, so a call is an ordinary call.
export function legacy(text: string): string {
  if (!text) throw new Error("legacy")
  return text
}

/** @throws {unknown} */
export function risky(text: string): string {
  if (!text) throw new Error("risky")
  return text
}
