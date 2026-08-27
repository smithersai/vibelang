/**
 * @module
 * @throws {Never}
 */
export const config = { retries: 3 };

// A near-miss trust marker. `Never` is not `never`, and
// specification/failures.mdx (Locked) prints the lowercase spelling for the
// opt-out while reserving `@throws {T}` for a declared channel whose type name
// TypeScript matches case-sensitively. A case-insensitive module-trust test
// grants this file the initialization trust it never claimed, and unlike the
// call boundary there is no second diagnostic left behind to notice: the edge
// is simply admitted. Nothing may be added above the JSDoc, for the reason
// recorded in module-resolution-tag.ts.
