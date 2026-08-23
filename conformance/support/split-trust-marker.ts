/**
 * @throws
 * {never}
 * @module
 */
export const settings = { retries: 4 };

// A near-miss trust marker. `@throws` and `{never}` are on two authored lines
// with a JSDoc decoration between them, so no `@throws {never}` marker was
// written. An implementation that compacts a comment by deleting its `*`
// characters assembles one anyway. Nothing may be added above the JSDoc, for
// the reason recorded in module-resolution-tag.ts.
