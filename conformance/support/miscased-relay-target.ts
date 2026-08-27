/** @MODULE @throws {never} */
export const config = { retries: 3 };

// A near-miss trust marker, reached at depth two behind a properly marked
// relay. `@MODULE` is not `@module` — a JSDoc tag name is not case-folded by
// TypeScript's own JSDoc parser, nor by the fork's — so this file makes no
// module-initialization claim at all, exactly as conformance/support/
// miscased-module-tag.ts does at depth one. Nothing may be added above the
// JSDoc, for the reason recorded in module-resolution-tag.ts.
//
// The pairing with the depth-one file is the point of the case that uses this
// one (09-foreign-calls/a-trust-marker-does-not-travel-through-a-trusted-
// module): the marker predicate is the same predicate at every depth, so a
// closure that asks the question at all gets the same answer here as
// 09-foreign-calls/miscased-trust-markers-do-not-confer-module-trust gets at
// the authored import. An implementation that only asks at depth one accepts
// this file and runs its initializer.
