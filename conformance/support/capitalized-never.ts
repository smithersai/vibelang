/**
 * @module
 * @throws {never}
 */

/** @throws {Never} */
export function probe(text: string): string {
  return text.toUpperCase();
}

// `Never` is not `never`. The lowercase spelling is the trusted opt-out; any
// other annotation names a type whose Error constructor must be resolvable, and
// no class named `Never` is in scope here. A case-insensitive comparison turns
// a declared-but-unreifiable channel into the trusted opt-out, which is the
// fail-open direction. The module header itself is a genuine, lowercase one.
