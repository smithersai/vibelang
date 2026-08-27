/** @module @THROWS {never} */
export const options = { retries: 5 };

// A near-miss trust marker. `@THROWS` is not `@throws`, so the opt-out the
// specification names was never written here — and this file is the third
// spelling of the same near miss, because the module claim is two tags and
// either one of them can be the one an implementation folds. Nothing may be
// added above the JSDoc, for the reason recorded in module-resolution-tag.ts.
