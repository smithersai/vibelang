import { test } from "node:test"

// Chapter 900: pending witness for EK4820 diagnostic - spec-rule: docs/design/src/900-appendices.md#60023ff767b4f2b5
test.todo('rule-evidence: docs/design/src/900-appendices.md#60023ff767b4f2b5 | Chapter 900: pending witness for EK4820 diagnostic | present | | interim `EK4820` | error: legacy compiler compatibility — an editor requests the historical return repair for `yield*` of an Effect that never succeeds.')

// Chapter 004: pending witness for per the proxy ruling of 2026 - spec-rule: docs/design/vips/0004-throw.md#80ede5107f580416
test.todo("rule-evidence: docs/design/vips/0004-throw.md#80ede5107f580416 | Chapter 004: pending witness for per the proxy ruling of 2026 | present | Per the proxy ruling of 2026-11-04, the inline catch mapper provably cannot throw; an unannotated imported `identity` may throw `unknown` and cannot satisfy the catch callback's `never` contract.")

// Chapter 900: pending witness for an ordinary main has no automatic - spec-rule: docs/design/src/900-appendices.md#1a789ca38d7aa2c7
test.todo('rule-evidence: docs/design/src/900-appendices.md#1a789ca38d7aa2c7 | Chapter 900: pending witness for an ordinary main has no automatic | present | An ordinary `main` has no automatic host invocation; run and provide its Effect explicitly.')

// Chapter 900: pending witness for EK4704 diagnostic - spec-rule: docs/design/src/900-appendices.md#303eb57c7dfdefe8
test.todo('rule-evidence: docs/design/src/900-appendices.md#303eb57c7dfdefe8 | Chapter 900: pending witness for EK4704 diagnostic | present | | interim `EK4704` | error: legacy compiler compatibility — the current lowering does not support a pattern form.')

// Chapter 900: pending witness for compose dependencies explicitly do not apply - spec-rule: docs/design/src/900-appendices.md#bda755bd1c4349fd
test.todo('rule-evidence: docs/design/src/900-appendices.md#bda755bd1c4349fd | Chapter 900: pending witness for compose dependencies explicitly do not apply | present | Compose dependencies explicitly; do not apply the historical `wire` repair.')

// Chapter 900: pending witness for EK4601 diagnostic - spec-rule: docs/design/src/900-appendices.md#92880f15baa127b9
test.todo('rule-evidence: docs/design/src/900-appendices.md#92880f15baa127b9 | Chapter 900: pending witness for EK4601 diagnostic | present | | interim `EK4601` | error: legacy compiler compatibility — `await` before a call returning an Effect in plain code.')

// Chapter 900: pending witness for ordinary return types retain typescript s - spec-rule: docs/design/src/900-appendices.md#0b5f327a4e2bf482
test.todo("rule-evidence: docs/design/src/900-appendices.md#0b5f327a4e2bf482 | Chapter 900: pending witness for ordinary return types retain typescript s | present | Ordinary return types retain TypeScript's treatment of `any`; use `try` to obtain an Effect's success value.")

// Chapter 900: pending witness for read the implementation with try service - spec-rule: docs/design/src/900-appendices.md#1a8e3f92dcfc8c49
test.todo('rule-evidence: docs/design/src/900-appendices.md#1a8e3f92dcfc8c49 | Chapter 900: pending witness for read the implementation with try service | present | Read the implementation with `try Service`, then select its member.')

// Chapter 900: pending witness for | interim \`EK4819\` | error: legacy compiler compatibility - spec-rule: docs/design/src/900-appendices.md#8883ec3ff2a18963
test.todo("rule-evidence: docs/design/src/900-appendices.md#8883ec3ff2a18963 | Chapter 900: pending witness for | interim \`EK4819\` | error: legacy compiler compatibility | present | | interim \`EK4819\` | error: legacy compiler compatibility — an editor requests the historical missing-star repair for \`yield effect\`.")

// Chapter 900: pending witness for | interim \`EK4409\` | warning: legacy compiler compatibility - spec-rule: docs/design/src/900-appendices.md#5048abc92958c40b
test.todo("rule-evidence: docs/design/src/900-appendices.md#5048abc92958c40b | Chapter 900: pending witness for | interim \`EK4409\` | warning: legacy compiler compatibility | present | | interim \`EK4409\` | warning: legacy compiler compatibility — a legacy Effect function returns a call of a value typed \`any\`.")

// Chapter 900: pending witness for | interim \`EK3204\` | error: legacy compiler compatibility - spec-rule: docs/design/src/900-appendices.md#c480a7c9187134b2
test.todo("rule-evidence: docs/design/src/900-appendices.md#c480a7c9187134b2 | Chapter 900: pending witness for | interim \`EK3204\` | error: legacy compiler compatibility | present | | interim \`EK3204\` | error: legacy compiler compatibility — a legacy \`wire\` argument's type does not expose its outputs.")
