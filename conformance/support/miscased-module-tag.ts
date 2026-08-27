/** @MODULE @throws {never} */
export const settings = { retries: 4 };

// A near-miss trust marker. A JSDoc tag name is not case-folded by TypeScript's
// own JSDoc parser, nor by the fork's, so `@MODULE` is not `@module` and this
// file makes no module-initialization claim at all. The compact one-line header
// is otherwise exactly the documented spelling — module-init-only.ts uses it and
// poc/src/build/source-assets.ts emits it — so the ONLY thing separating this
// file from a genuine claim is the casing of six letters. Nothing may be added
// above the JSDoc, for the reason recorded in module-resolution-tag.ts.
