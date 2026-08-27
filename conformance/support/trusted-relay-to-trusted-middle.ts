/** @module @throws {never} */
export { config } from "./trusted-relay-middle.ts";

// The first hop of the depth-three chain. Both this file and the middle relay
// carry the marker; the module at the end of the chain does not. Two marked
// hops are exactly as far as the trust claim reaches: one module each.
