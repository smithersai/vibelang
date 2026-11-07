// Pending coverage obligations; each activation checks the whole assigned rule.
import { test } from "node:test"

// rule-evidence: docs/design/vips/0033-platform-stdlib.md#9adea56c74ab839d
// VIP-33: module body native platform rules.
// Activation: Compile identical platform references in a named top-level module body and sibling .ts file, with a .vibe outer-scope negative control.
test.todo("rule-evidence: docs/design/vips/0033-platform-stdlib.md#decision | cov2-vips-b module body native platform rules | present | A named top-level `module` body follows the rules of a sibling `.ts` file; VIP-40 supersedes VIP-25.")

// rule-evidence: docs/design/vips/0033-platform-stdlib.md#d13dd74b1a3ce38a
// VIP-33: vibe bans node values and globals.
// Activation: Reject node:* value imports, process and Buffer in .vibe including wrapper arrows; retain type-only import and module-body controls.
test.todo("rule-evidence: docs/design/vips/0033-platform-stdlib.md#decision | cov2-vips-b vibe bans node values and globals | present | Outside a TypeScript `module` body, a `.vibe` file has no `node:*` value imports and no Node globals (`process`, `Buffer`).")

// rule-evidence: docs/design/vips/0033-platform-stdlib.md#1c208562e180707d
// VIP-33: native platform code homes.
// Activation: Compare the named module and sibling .ts alternatives with the rejected outer .vibe platform reference, preserving public types.
test.todo("rule-evidence: docs/design/vips/0033-platform-stdlib.md#decision | cov2-vips-b native platform code homes | present | Code that needs them lives in a `.ts` file or a named top-level `module` body ([VIP-40](0040-module-declarations.md), which supersedes VIP-25).")

// rule-evidence: docs/design/vips/0033-platform-stdlib.md#af700d45440d7ea1
// VIP-33: platform quick fix and codemod.
// Activation: Compare fresh sibling-module and Effect-service repairs in isolated fixtures; check phase, captures, receiver, types and absent-path protection.
test.todo("rule-evidence: docs/design/vips/0033-platform-stdlib.md#decision | cov2-vips-b platform quick fix and codemod | present | Its quick fix and the codemod move the body into a sibling `.ts` module, or point to the Effect service (`HttpClient` for `fetch`).")

// rule-evidence: docs/design/vips/0033-platform-stdlib.md#e6ded71d7db14c05
// VIP-33: prelude subpath namespaces.
// Activation: Resolve HttpClient/FileSystem/Path/ChildProcess from pinned Effect subpaths with local/import shadowing and effectModules:false controls.
test.todo("rule-evidence: docs/design/vips/0033-platform-stdlib.md#decision | cov2-vips-b prelude subpath namespaces | present | **Subpath namespaces are in scope** (`HttpClient`, `FileSystem`, `Path`, `ChildProcess`, \u2026 from Effect's subpath packages), with VIP-14's precedence rules.")

// rule-evidence: docs/design/vips/0033-platform-stdlib.md#23a5d1fa40a9b502
// VIP-33: filesystem namespace versus service key.
// Activation: Compare try FileSystem.FileSystem and try Path.Path with yielded namespaces, requiring service success versus native namespace defect.
test.todo("rule-evidence: docs/design/vips/0033-platform-stdlib.md#decision | cov2-vips-b filesystem namespace versus service key | present | *Corrected 2026-10-29: the module `FileSystem` is a namespace, and the service key it exports is `FileSystem.FileSystem` (likewise `Path.Path`); in effect 4.1.1, `yield*` of the namespace is a defect.*")

// rule-evidence: docs/design/vips/0033-platform-stdlib.md#62d8805f69f4827a
// VIP-33: platform quick fix service names.
// Activation: Require the correct service replacement for Path/Config.String cases and safe sibling-.ts alternatives for unsupported globals.
test.todo("rule-evidence: docs/design/vips/0033-platform-stdlib.md#decision | cov2-vips-b platform quick fix service names | present | The quick fix names the Effect service (`Path`, `Config.String`) or moves the code to a `.ts` file.")

// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#b800f23f36b5c9ca
// VIP-34: formatter plugin integrations.
// Activation: Run pinned Prettier/dprint/Oxfmt commands over .vibe fixtures through their plugins; compare semantic projection and second-run idempotence.
test.todo("rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#decision | cov2-vips-b formatter plugin integrations | present | Prettier, dprint and Oxfmt reach it through plugins, so a repo's existing formatter command covers `.vibe` files.")

