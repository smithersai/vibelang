/** @moduleResolution bundler @throws {never} */
export const config = { retries: 3 };

// A near-miss trust marker. `@moduleResolution` is an ordinary tag people
// write, and it is not `@module`. A `@module` test with no boundary after the
// tag name matches it by prefix and grants module-initialization trust this
// file never claimed. Nothing may be added above the JSDoc: a leading comment
// would give an implementation a second, unrelated reason to refuse the file,
// and the case would then pass without observing the boundary rule.
