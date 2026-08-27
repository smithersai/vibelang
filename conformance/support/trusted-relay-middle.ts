/** @module @throws {never} */
export { config } from "./unmarked-relay-target.ts";

// The second hop of the depth-three chain, reached from
// trusted-relay-to-trusted-middle.ts. Properly marked, and re-exporting a
// module that is not marked at all. Its content is deliberately identical to
// trusted-relay-to-unmarked-target.ts apart from this comment: the ONLY
// difference between the depth-two case and the depth-three case is how many
// marked relays sit in front of the same unmarked module, so the pair measures
// depth and nothing else.
