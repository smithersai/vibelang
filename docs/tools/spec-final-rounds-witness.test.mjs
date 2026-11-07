import { test } from "node:test"

// Evidence for the final rounds 35-36 specification cut and Will's EK4802 ruling.
// These are explicit pending compiler obligations, not claims of executed
// compiler coverage. The historical base has no exact inherited citations for
// these rules. spec-002-simplification.test.mjs carries the one inherited test.
// Keep each obligation at top level with the exact chapter, section and sentence.

test.todo("rule-evidence: docs/design/src/001-functions.md#legacy-written-infer-return-slots | final-10 VIP-3 repair does not insert execution | present | The migration does not add `effect`, `try` or execution merely because a return annotation qualified.")
test.todo("rule-evidence: docs/design/src/001-functions.md#legacy-written-infer-return-slots | final-18 VIP-3 post-retirement TS1338 ownership | present | After this migration retires, `TS1338` alone remains wherever TypeScript rejects the occurrence.")
test.todo("rule-evidence: docs/design/src/001-functions.md#legacy-written-infer-return-slots | final-19 VIP-3 preserving channel repair and unnameable-type refusal | present | `--fix` writes checker-proved inferred channel types, preserving declaration types and runtime behavior, or refuses with an explanation if it cannot name those types safely.")
test.todo("rule-evidence: docs/design/src/001-functions.md#legacy-written-infer-return-slots | final-20 VIP-3 all-infer annotation removal requires explicit effect and preservation | present | It may remove the whole return annotation only on an explicitly `effect`-marked callable when every channel is `infer` and preservation is proved.")
test.todo("rule-evidence: docs/design/vips/0003-effect-type-shorthand.md#footnote-old-vibelang | final-32 VIP-3 all-infer removal preserves declarations on explicit effect only | present | Migration error `EK4857` replaces a legacy written `infer` slot with the checker's inferred type, or removes an explicitly `effect`-marked callable's whole annotation when all slots are `infer`, preserving declaration types under VIP-34's safe-fix checks.")
test.todo("rule-evidence: docs/design/vips/0003-effect-type-shorthand.md#footnote-old-vibelang | final-33 VIP-3 unmarked return-slot TS1338 replacement with independent errors | present | For the same immediate written `infer` channel in the [explicit legacy return-slot set](../src/001-functions.md#legacy-written-infer-return-slots), including an unmarked body-bearing callable whose Effect annotation selected the legacy model, `EK4857` replaces `TS1338` while this migration exists, following VIP-34's specific-diagnostic rule; independent native errors remain.")
test.todo("rule-evidence: docs/design/vips/0003-effect-type-shorthand.md#footnote-old-vibelang | final-34 VIP-3 conditional infer and nonmigration native diagnostics | present | Valid conditional-type inference and native `infer` outside the migration keep TypeScript's rules and diagnostics.")
test.todo("rule-evidence: docs/design/vips/0003-effect-type-shorthand.md#footnote-old-vibelang | final-35 VIP-3 retirement restores native TS1338 | present | After retirement, `TS1338` remains wherever TypeScript rejects that occurrence.")
