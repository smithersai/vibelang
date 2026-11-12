// Pending coverage obligations; each activation checks the whole assigned rule.
import { test } from "node:test"

// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#ff151d9ebd90c274 docs/design/vips/0034-compiler-and-tooling.md#2de0a27e7032dc6e docs/design/src/007-tooling.md#e03ee3fc078390fd docs/design/src/007-tooling.md#9b3a007ec75cfcf0
// VIP-34 and chapter 7: formatter integrations. Prettier and dprint reach the formatter through plugins; Oxfmt has none.
// Covered today, outside the rule-evidence witness forms: packages/compiler/test/prettier.test.mjs and dprint.test.mjs
// (the plugins), and .smithers/flows/migrate/test/tooling.test.mjs (Oxfmt scripts gain vibelang-format).
// Activation: run pinned Prettier, dprint and Oxfmt repositories through their own format commands over .vibe fixtures;
// compare the semantic projection and second-run idempotence, and check that raw `oxfmt file.vibe` stays unsupported.
test.todo("rule-evidence: docs/design/src/007-tooling.md#formatting-and-existing-tools | cov2-vips-b formatter integrations | present | Prettier and dprint reach it through plugins, so a repository's existing formatter command covers `.vibe` files.")
test.todo("rule-evidence: docs/design/src/007-tooling.md#formatting-and-existing-tools | cov2-vips-b formatter integrations | present | Oxfmt has no plugin interface, so a repository's Oxfmt format and check scripts run `vibelang-format` after Oxfmt ([VIP-34](../vips/0034-compiler-and-tooling.md)).")
test.todo("rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#decision | cov2-vips-b formatter integrations | present | Prettier and dprint reach it through plugins, so a repo's existing formatter command covers `.vibe` files.")
test.todo("rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#decision | cov2-vips-b formatter integrations | present | Oxfmt has no plugin interface, so a repo's Oxfmt format and check scripts run `vibelang-format` after Oxfmt.")
test.todo("rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#wills-words | cov2-vips-b formatter integrations | present | Prettier (`vibelang/prettier`) and dprint reach the formatter through plugins; Oxfmt repositories run `vibelang-format --write` or `--check` after Oxfmt in their format scripts, and `oxfmt file.vibe` is unsupported.")
