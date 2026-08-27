/* @module @throws {never} */
export const settings = { retries: 4 };

// A near-miss trust marker. One asterisk, not two: `/* ... */` is an ordinary
// block comment and a JSDoc comment opens with `/**`. The tag text is exactly
// right and the comment kind is not, which is the whole boundary. Nothing may
// be added above it, for the reason recorded in module-resolution-tag.ts.
