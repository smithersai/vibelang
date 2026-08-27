/** @module @throws {never} */
export { config } from "./trusted-relay-target.ts";

// The KEEP-GREEN relay: properly marked, over a properly marked target. Its
// shape is character for character the shape of
// trusted-relay-to-unmarked-target.ts, and the only difference between the two
// programs is whether the module at the end of the edge wrote the marker. An
// over-correction that refuses a transitive edge because it is transitive,
// rather than because the module it reaches made no claim, fails here and
// passes there.
