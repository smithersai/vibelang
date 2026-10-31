import assert from "node:assert/strict"
import test from "node:test"
import { read } from "./spec-witness.mjs"

for (const path of [
  "docs/design/src/007-tooling.md",
  "docs/design/vips/0038-effect-lint-built-in.md",
  "docs/user/src/setup/vibelang-cli.md",
  "docs/user/src/getting-started/012-devtools.md"
]) {
  test(path + ": imported lint preserves mixed-input applicability", () => {
    const text = read(path)
    assert.match(text, /selected \x60\.ts\x60 and \x60\.vibe\x60 inputs/)
    assert.match(text, /pinned upstream rule\/file eligibility and declaration\/library exclusions/)
    assert.match(text, /existing Effect language-service configuration/)
    if (!path.includes("012-devtools")) {
      assert.match(text, /VibeLang-specific language checks remain confined to \x60\.vibe\x60/)
    } else {
      assert.match(text, /Language diagnostics report in \x60\.vibe\x60 files/)
      assert.match(text, /a \x60\.ts\x60 file keeps TypeScript's verdict/)
    }
  })
}
