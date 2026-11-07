// rule-evidence: docs/design/src/008-runtime.md#runtime-guarantees | Without prior host or runtime initialization, `Symbol.customMatcher` can be `undefined` even when its ambient type is visible.
// The type-only import makes the runtime's ambient Symbol.customMatcher type
// visible and is erased, so nothing initializes the key.
import type { customMatcher } from "vibelang-runtime"

export const key: typeof customMatcher = Symbol.customMatcher
export const kind = typeof key
// Stable rule id: docs/design/src/008-runtime.md#2437126e62e206be
