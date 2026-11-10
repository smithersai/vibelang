import { test } from "node:test"

// VIP-33: exact staging obligations until the host-metadata checker change lands.
// The implementation's compiler and bundler regressions discharge these obligations.

test.todo("rule-evidence: docs/design/src/005-services.md#the-platform-standard-library | VIP-33 implementation | present | **Amended 2026-11-09: `import.meta` follows TypeScript.** [VIP-33's amendment](../vips/0033-platform-stdlib.md#decision) records: \"Vibelang should allow it if it's using vite.")
test.todo("rule-evidence: docs/design/src/005-services.md#the-platform-standard-library | VIP-33 implementation | present | This supersedes VIP-33's earlier restriction to `import.meta.url` (decided detail 90).")
test.todo("rule-evidence: docs/design/src/005-services.md#the-platform-standard-library | VIP-33 implementation | present | VibeLang imposes no additional restriction on `import.meta` syntax.")
test.todo("rule-evidence: docs/design/src/005-services.md#the-platform-standard-library | VIP-33 implementation | present | Members are checked against the program's `ImportMeta` declarations.")
test.todo("rule-evidence: docs/design/src/005-services.md#the-platform-standard-library | VIP-33 implementation | present | With `vite/client`, `glob`, `env` and `hot` have Vite's declared types; with `@types/node`, Node's metadata such as `dirname` has Node's declared type.")
test.todo("rule-evidence: docs/design/src/005-services.md#the-platform-standard-library | VIP-33 implementation | present | An undeclared member receives TypeScript's ordinary diagnostic, not `EK4402`.")
test.todo("rule-evidence: docs/design/src/005-services.md#the-platform-standard-library | VIP-33 implementation | present | `import.meta.url` keeps its ordinary module identity.")
test.todo("rule-evidence: docs/design/src/005-services.md#the-platform-standard-library | VIP-33 implementation | present | Injected runtime configuration uses `Config.String`:")
test.todo("rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | VIP-33 implementation | present | CommonJS does not justify retaining the retired dispatcher; introducing `import.meta.main` requires proof that the original host supports the same entry test; availability in `ImportMeta` declarations alone is insufficient.")
test.todo("rule-evidence: docs/design/vips/0033-platform-stdlib.md#decision | VIP-33 implementation | present | **Amended 2026-11-09 (Will): `import.meta` follows TypeScript.** This supersedes the earlier restriction to `import.meta.url` (decided detail 90).")
test.todo("rule-evidence: docs/design/vips/0033-platform-stdlib.md#decision | VIP-33 implementation | present | VibeLang imposes no additional restriction on `import.meta` syntax.")
test.todo("rule-evidence: docs/design/vips/0033-platform-stdlib.md#decision | VIP-33 implementation | present | Members are checked against the program's `ImportMeta` declarations: `vite/client` supplies `glob`, `env` and `hot`; `@types/node` supplies Node metadata such as `dirname`.")
test.todo("rule-evidence: docs/design/vips/0033-platform-stdlib.md#decision | VIP-33 implementation | present | An undeclared member receives TypeScript's ordinary diagnostic, not `EK4402`.")
test.todo("rule-evidence: docs/design/vips/0033-platform-stdlib.md#decision | VIP-33 implementation | present | Aliases, destructuring, computed access, arguments, spreads and `import.meta.url` retain TypeScript's behavior.")
