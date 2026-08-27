/**
 * @module
 * @throws {
   never
   }
 */

/** @throws {never} */
export function measure(text: string): number {
  return text.length;
}

// The positive control for the whitespace class. The braces of the opt-out are
// separated from `never` by newlines and ordinary spaces, which are JSDoc
// whitespace, so this file DOES make the module-initialization claim. There is
// deliberately no `*` decoration on the two inner lines: a decoration between
// `@throws` and `{never}` is the split-marker near miss that
// split-trust-marker.ts pins refused. `measure` carries its own function-level
// `@throws {never}`, because the module claim never doubles as one.
