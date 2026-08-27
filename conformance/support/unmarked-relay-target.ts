export const config = { retries: 3 };

// This module carries NO leading `@module` / `@throws {never}` initialization
// trust claim, and nothing may be added above the first statement: a leading
// JSDoc is exactly what this file must not have. It is reached only at depth
// two or more, behind a relay that DOES carry the claim, which is the whole
// point — the trust marker certifies the module that writes it and no module
// it goes on to load. Three cases share this one file:
//
//   09-foreign-calls/an-unmarked-module-behind-a-trusted-relay-is-refused
//     reaches it through one marked relay's `export { config } from` and must
//     be REFUSED;
//   09-foreign-calls/module-trust-does-not-travel-two-hops
//     reaches it through two marked relays and must be REFUSED, so depth is
//     not a bound;
//   09-foreign-calls/a-deferred-foreign-loader-needs-no-marker-behind-it
//     reaches it only from inside an un-called `async function` body and must
//     be ACCEPTED, because a proven-deferred `import()` is not an
//     initialization edge and nothing loads this file at all.
//
// The last one is why the file is shared rather than copied: the SAME unmarked
// module is refused behind a static edge and accepted behind a deferred one,
// so an implementation that answers the question by file identity instead of
// by edge kind cannot pass both.
