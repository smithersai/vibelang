/**
 * A genuinely trusted module initializer: the tags sit on their own decorated
 * lines inside one leading JSDoc comment.
 *
 * @module
 * @throws {never}
 */

/** @throws {never} */
export function safe(text: string): string {
  return text.toUpperCase();
}

// The positive control for the trust-marker grammar. Multi-line is the
// ordinary way a real header is written, so an implementation that required
// the two tags to be adjacent — the over-correction available while closing
// the split-marker hole — would refuse this legitimate module. `safe` carries
// its own function-level claim, because the module claim never doubles as one.
