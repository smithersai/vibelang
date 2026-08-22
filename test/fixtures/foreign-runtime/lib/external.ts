/** @module @throws {never} */
import { basename } from "node:path"

/** @throws {never} */
export function externalValue(): string {
  return basename("/foreign/external")
}
