// Pending coverage obligations; each activation checks the whole assigned rule.
import { test } from "node:test"

// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#b800f23f36b5c9ca
// VIP-34: formatter plugin integrations.
// Activation: Run pinned Prettier/dprint/Oxfmt commands over .vibe fixtures through their plugins; compare semantic projection and second-run idempotence.
test.todo("rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#decision | cov2-vips-b formatter plugin integrations | present | Prettier, dprint and Oxfmt reach it through plugins, so a repo's existing formatter command covers `.vibe` files.")

