// /** @module @throws {never} */
export const config = { retries: 3 };

// A near-miss trust marker. The marker's exact text is present, and the file
// makes no claim at all: a `//` line comment is not a JSDoc comment, so there
// is no leading JSDoc for the module-initialization claim to live in. An
// implementation that searches the leading TEXT for `/**` finds one here and
// grants trust a line comment cannot carry. Nothing may be added above it, for
// the reason recorded in module-resolution-tag.ts.
