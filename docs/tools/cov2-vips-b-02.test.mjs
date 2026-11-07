// Pending coverage obligations; each activation checks the whole assigned rule.
import { test } from "node:test"

// rule-evidence: docs/design/vips/0030-config-files.md#620eaee7d226e458
// VIP-30: native ts js module detection.
// Activation: Cross legacy/auto/force and package type for ordinary .ts and .js with prelude switches off, comparing script binding and diagnostics against native TypeScript.
test.todo("rule-evidence: docs/design/vips/0030-config-files.md#decision | cov2-vips-b native ts js module detection | present | **Amendment: source module classification.** `moduleDetection` keeps its ordinary meaning for `.ts` and `.js`.")

// rule-evidence: docs/design/vips/0030-config-files.md#af110eae679bbb0b
// VIP-30: no declarationImportStyle setting.
// Activation: Require EK3007 for the retired setting and compare ordinary .d.ts import spelling with TypeScript option controls.
test.todo("rule-evidence: docs/design/vips/0030-config-files.md#decision | cov2-vips-b no declarationImportStyle setting | present | **Amended 2026-11-03: declaration import spelling follows TypeScript.** There is no `declarationImportStyle` setting.")

// rule-evidence: docs/design/vips/0030-config-files.md#c77e9663aa746fc7
// VIP-30: interim severity code rejection.
// Activation: Try warning/error/off severities for EK9201 and EK9202 and require EK3006 without changing their default diagnostics.
test.todo("rule-evidence: docs/design/vips/0030-config-files.md#wills-words | cov2-vips-b interim severity code rejection | present | **Amended 2026-11-01: interim severity codes.** Interim `EK92xx` codes are not configurable through `vibe.severities`, even when printed as warnings; an entry is `EK3006`.")

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

// rule-evidence: docs/design/vips/0033-platform-stdlib.md#858260c113fa8903
// VIP-33: origin based banned globals.
// Activation: Resolve symbols from each banned lib family and allowed ES/decorators family, with allowlist and local-shadow controls; require EK4402 only for banned resolved origins.
test.todo("rule-evidence: docs/design/vips/0033-platform-stdlib.md#decision | cov2-vips-b origin based banned globals | present | **Amended 2026-10-29: the banned globals are derived, not listed.** A value reference in `.vibe` code is `EK4402` when the symbol it resolves to is declared in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, not in `lib.es*.d.ts` or `lib.decorators*.d.ts`, and is not on the allowlist.")

// rule-evidence: docs/design/vips/0033-platform-stdlib.md#62d8805f69f4827a
// VIP-33: platform quick fix service names.
// Activation: Require the correct service replacement for Path/Config.String cases and safe sibling-.ts alternatives for unsupported globals.
test.todo("rule-evidence: docs/design/vips/0033-platform-stdlib.md#decision | cov2-vips-b platform quick fix service names | present | The quick fix names the Effect service (`Path`, `Config.String`) or moves the code to a `.ts` file.")

// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#b800f23f36b5c9ca
// VIP-34: formatter plugin integrations.
// Activation: Run pinned Prettier/dprint/Oxfmt commands over .vibe fixtures through their plugins; compare semantic projection and second-run idempotence.
test.todo("rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#decision | cov2-vips-b formatter plugin integrations | present | Prettier, dprint and Oxfmt reach it through plugins, so a repo's existing formatter command covers `.vibe` files.")

// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#8b7166d0d577488c
// VIP-34: fix convergence and pass limit.
// Activation: Run chained fixes to a fixed point, assert a second invocation changes no bytes, and force pass-limit exhaustion to require a remaining-fixes error.
test.todo("rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#decision | cov2-vips-b fix convergence and pass limit | present | **Amended 2026-10-31: `--fix` reaches a fixed point, and a missing runtime is one error.** One `vibelang --fix` run applies fixes until none applies; running it again changes nothing, and a run that has not converged within its pass limit reports the remaining fixes as an error.")

