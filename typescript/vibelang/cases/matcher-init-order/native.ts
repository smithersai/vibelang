// rule-evidence: docs/design/src/008-runtime.md#runtime-guarantees | TypeScript modules (`.ts`, `.tsx` and VIP-40 bodies) retain ordinary dependency order and arrange initialization before using the key, normally with `import "vibelang-runtime"` first.
// The compiler inserts nothing: probe-c evaluates before the runtime and sees
// no key, probe-d after it and sees the key.
import { seen as before } from "./probe-c.ts"
import "vibelang-runtime"
import { seen as after } from "./probe-d.ts"

export class Odd {
  static [Symbol.customMatcher](value: unknown) {
    return typeof value === "number" && value % 2 === 1
  }
}

export const order = [before, after]
export const key = Symbol.customMatcher
// Stable rule id: docs/design/src/008-runtime.md#893a8957e409f88f
