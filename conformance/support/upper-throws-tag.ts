/**
 * @module
 * @throws {never}
 */

/** @THROWS {never} */
export function probe(text: string): string {
  return text.toUpperCase();
}

// The CALL-boundary half of the tag-name rule, and the asymmetry is the point.
// `capitalized-never.ts` miscases what is inside the braces, so the annotation
// is still an annotation and reports SMITHERS1502 for a channel that cannot be
// reified. `@THROWS` miscases the TAG NAME, so there is no annotation at all —
// no 1502 to notice, just the default panic case and the unconsumed Result it
// leaves. Two spellings, two failure modes, and only one of them leaves a
// second diagnostic behind. The module header itself is a genuine, lowercase
// one, so nothing but the function-level tag is under test.
