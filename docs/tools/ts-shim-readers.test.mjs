import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
test("the shim proposal and guide disclose successful stock compilation with different meaning", () => {
  for (const path of ["../design/vips/0042-vibelang-in-ts-files-open.md", "../user/src/setup/typescript-shim.md"]) {
    const text = read(path)
    assert.match(text, /export const request = Request/, path)
    assert.match(text, /effect\/Request/, path)
    assert.match(text, /constructor/, path)
    assert.doesNotMatch(text, /either fails a stock tool's parser, or means the same|it means there what it means in VibeLang|The third is loud\./, path)
  }
})
test("the prelude collision remains an open proposal question", () => {
  const text = read("../design/vips/0042-vibelang-in-ts-files-open.md")
  assert.match(text, /## Open question/)
  assert.match(text, /prelude/)
  assert.match(text, /\*\*Status:\*\* open/)
})
