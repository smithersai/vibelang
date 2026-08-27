/** @module @throws {never} */
export { config } from "./unmarked-relay-target.ts";

// A properly marked relay over an ENTIRELY unmarked target. The sibling relay
// trusted-relay-to-miscased-target.ts separates the two failures that look
// alike from the outside: there the marker did not match, here no marker was
// written at all. A closure that never asks the question produces the same
// silence in both, which is why both cases exist.
