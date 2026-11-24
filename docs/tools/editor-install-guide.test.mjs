import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

for (const path of ["../user/src/setup/vscode.md", "../../editors/vscode/README.md"]) {
  test(`${path}: shell command prerequisite precedes extension installation`, () => {
    const text = readFileSync(new URL(path, import.meta.url), "utf8")
    const install = text.indexOf("code --install-extension")
    assert.ok(install >= 0, "missing extension installation command")
    const before = text.slice(0, install)
    assert.match(before, /macOS/)
    assert.match(before, /Shell Command: Install 'code' command in PATH/)
    assert.match(before, /Shell Command: Install 'cursor' command in PATH/)
    assert.match(before, /new terminal/)
  })
}
