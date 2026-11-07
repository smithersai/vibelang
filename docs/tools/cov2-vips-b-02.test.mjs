// Pending coverage obligations; each activation checks the whole assigned rule.
import { test } from "node:test"

// rule-evidence: docs/design/vips/0033-platform-stdlib.md#62d8805f69f4827a
// VIP-33: platform quick fix service names.
// Activation: Require the correct service replacement for Path/Config.String cases and safe sibling-.ts alternatives for unsupported globals.
test.todo("rule-evidence: docs/design/vips/0033-platform-stdlib.md#decision | cov2-vips-b platform quick fix service names | present | The quick fix names the Effect service (`Path`, `Config.String`) or moves the code to a `.ts` file.")

// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#b800f23f36b5c9ca
// VIP-34: formatter plugin integrations.
// Activation: Run pinned Prettier/dprint/Oxfmt commands over .vibe fixtures through their plugins; compare semantic projection and second-run idempotence.
test.todo("rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#decision | cov2-vips-b formatter plugin integrations | present | Prettier, dprint and Oxfmt reach it through plugins, so a repo's existing formatter command covers `.vibe` files.")

