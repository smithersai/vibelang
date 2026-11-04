// Detail 263: under the default style a written ./helper.ts, an unmigrated
// sibling, stays ./helper.ts; only ./runtime.vibe becomes ./runtime.js.
import type { Helper } from "./helper.ts"

export * as Runtime from "./runtime.js"
export { helper } from "./helper.ts"
export const twice = (x: Helper): number => x.n * 2
