/** @module @throws {never} */
import { nestedCts } from "./nested.cts"

/** @throws {never} */
export function ctsValue(): string {
  return `cts-${nestedCts()}`
}
