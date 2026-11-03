import type { Cause } from "effect/Cause"

// JavaScript's throw keeps the object it is given, a Cause included.
export function plain(cause: Cause<never>): string {
  try { throw cause } catch (e) { return e === cause ? "same object" : "another value" }
}
