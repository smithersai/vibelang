import { test } from "node:test"

// Evidence for the final rounds 35-36 specification cut and Will's EK4802 ruling.
// These are explicit pending compiler obligations, not claims of executed
// compiler coverage. The historical base has no exact inherited citations for
// these rules. spec-002-simplification.test.mjs carries the one inherited test.
// Keep each obligation at top level with the exact chapter, section and sentence.

test.todo("rule-evidence: docs/design/src/001-functions.md#legacy-written-infer-return-slots | final-18 VIP-3 post-retirement TS1338 ownership | present | After this migration retires, `TS1338` alone remains wherever TypeScript rejects the occurrence.")
test.todo("rule-evidence: docs/design/vips/0003-effect-type-shorthand.md#footnote-old-vibelang | final-35 VIP-3 retirement restores native TS1338 | present | After retirement, `TS1338` remains wherever TypeScript rejects that occurrence.")
