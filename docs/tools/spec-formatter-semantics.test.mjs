import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = process.env.SPEC_FORMATTER_ROOT || fileURLToPath(new URL("../../", import.meta.url))
const read = path => readFileSync(resolve(root, path), "utf8")
for (const path of ["docs/design/src/007-tooling.md", "docs/design/vips/0034-compiler-and-tooling.md", "docs/user/src/setup/formatting.md"]) {
  test(`formatter meaning and source-text boundaries agree in ${path}`, () => {
    const text = read(path)
    for (const term of ["parsed program meaning", "receivers", "throws contracts", "diagnostic codes", "categories", "occurrences", "Function.prototype.toString", "emitted JavaScript bytes", "tagged-template raw", "directive semantics", "sourcesContent"]) {
      assert.ok(text.toLowerCase().includes(term.toLowerCase()), `missing ${term}`)
    }
    assert.doesNotMatch(text, /preserves[^.\n]*emitted JavaScript exactly|preserves its diagnostic codes and emitted JavaScript apart|preserves diagnostic codes and executable JavaScript|executable[^.\n]*byte[- ]for[- ]byte/i)
  })
}

test("a long provider list stays on one line and the formatter adds no Layer.mergeAll", () => {
  const tooling = read("docs/design/src/007-tooling.md")
  assert.doesNotMatch(tooling, /Wrap a long list/)
  assert.match(tooling, /A long provider list stays on one line\. The formatter neither introduces nor removes `Layer\.mergeAll\(…\)`/)
})
