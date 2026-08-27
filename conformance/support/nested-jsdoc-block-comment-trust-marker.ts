/* /** @module @throws {never} */
export const options = { retries: 5 };

// A near-miss trust marker. The comment is an ordinary block comment whose
// CONTENT begins `/**`, so a leading-text search for `/**` finds a JSDoc that
// the scanner never produced: the comment opened at `/*` and ends at the first
// `*/`. Nothing may be added above it, for the reason recorded in
// module-resolution-tag.ts.
