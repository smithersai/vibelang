// Types alone execute nothing: this type-only reference to the runtime's key
// leaves the global key uninitialized.
import type { customMatcher } from "vibelang-runtime"
export type Key = typeof customMatcher
export const typed = typeof (Symbol as { customMatcher?: symbol }).customMatcher
