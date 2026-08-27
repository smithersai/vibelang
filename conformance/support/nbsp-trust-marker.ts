/** @module @throws { never } */
export const limits = { retries: 6 };

// A near-miss trust marker. The two characters inside the braces are U+00A0,
// NO-BREAK SPACE, not the space JSDoc separates a tag from its type with. The
// braces therefore hold a type whose spelling is not `never`, which is the
// `@throws {T}` production and not the opt-out. Nothing may be added above it,
// for the reason recorded in module-resolution-tag.ts.
