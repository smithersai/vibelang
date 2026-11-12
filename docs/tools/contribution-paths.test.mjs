import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// A reader of the README, the site home or CONTRIBUTING learns where a bug in the
// published packages goes (this repository's issues) and where a language proposal
// goes (the factory, whose repository has no compiler yet).
const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8")
for (const path of ["README.md", "site/src/index.mdx", "site/src/pages/index.mdx", "CONTRIBUTING.md"]) {
  test(path + " says where to report a bug and where to propose a language change", () => {
    const text = read(path)
    assert.match(text, /https:\/\/github\.com\/smithersai\/vibelang\/issues\/new/)
    assert.match(text, /\(https:\/\/lang\.smithers\.sh\)/)
    assert.match(text, /new implementation of VibeLang with no compiler yet/)
  })
}
