/** @module @throws {never} */
export async function load() { return (await import("./unmarked-relay-target.ts")).config; }
export const config = { retries: 3 };

// The KEEP-GREEN for the deferral proof. This module's initialization loads
// nothing: the `import()` sits inside the body of an exported module-scope
// `async function` that no module-scope code calls, so evaluating this file
// evaluates the function DECLARATION and never the import inside it.
// ./unmarked-relay-target.ts is therefore not an initialization edge and needs
// no trust marker — and it has none, deliberately, since
// 09-foreign-calls/an-unmarked-module-behind-a-trusted-relay-is-refused
// requires that same file to be REFUSED behind a static edge.
//
// `config` is exported eagerly so the authored `.sm` can bind a value without
// calling `load`, which keeps the case's `typeof` a plain module read and
// leaves the deferral the only thing under test.
