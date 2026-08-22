/** @module @throws {never} */
export { nestedValue } from "./nested.ts"

/** @throws {never} */
export function trustedTs(): string {
  return "ts"
}

export function unsafeTs(value: string): string {
  if (value.length === 0) throw new Error("empty")
  return "panic-wrapped"
}
