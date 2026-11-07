// Pending coverage obligations; each activation checks the assigned rule.
import { test } from "node:test"

// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#154f036bc6f3f655
// VIP-34: two fix scope flags.
// Activation: Exercise both documented scope flags with --fix, comparing their selected and excluded fix classes in isolated fixtures.
test.todo("rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#decision | cov2-vips-b two fix scope flags | present | **Amended 2026-10-31: `--fix` scope flags.** Two flags scope a `vibelang --fix` invocation.")

// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#aa7610cec6aa9750
// VIP-34: migration only scope.
// Activation: Run --fix-migration-only on mixed migration/teaching/prelude/import candidates and assert only migration fixes apply.
test.todo("rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#decision | cov2-vips-b migration only scope | present | `--fix-migration-only` selects migration fixes, excluding TypeScript-form teaching rewrites and prelude/import cleanup.")

// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#ca84885170cf9637
// VIP-34: VIP only scope.
// Activation: Run --fix-vip-only on function-kind and legacy try candidates plus prelude/import controls; assert only the VIP migration passes apply.
test.todo("rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#decision | cov2-vips-b VIP only scope | present | `--fix-vip-only` selects the VIP migration passes, including the VIP-1/VIP-2 function-kind and `try` migration, excluding prelude/import cleanup.")

// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#788fb321493e1069
// VIP-34: config traversal repository boundary.
// Activation: Use isolated nested config fixtures, external extends and node_modules; external configs must be reported and their bytes preserved.
test.todo("rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#wills-words | cov2-vips-b config traversal repository boundary | present | Config traversal stops at the repository boundary and `node_modules`; external configs are reported, never edited.")

// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#c39fdb1d691c2d86
// VIP-34: fix excludes foreign and generated inputs.
// Activation: Seed dependency/typeRoot/lib/TS/JS/declaration/output/buildinfo/lock/reference files with fixable-looking text; assert only owned project Vibe sources change.
test.todo("rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#wills-words | cov2-vips-b fix excludes foreign and generated inputs | present | Dependencies, `typeRoots`, bundled libs, foreign TypeScript/JavaScript, declarations, emitted output, build info, lock files and other referenced projects are excluded.")

// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#4f5596f6f7f2a3e4
// VIP-34: build fix project ownership.
// Activation: Use a referenced-project graph with distinguishable source fixes and record build order; each project may edit only its own source files.
test.todo("rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#wills-words | cov2-vips-b build fix project ownership | present | In `-b`, each project fixes its own files in build order.")
