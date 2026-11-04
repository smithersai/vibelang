import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import fc from "fast-check"

const read = path => readFileSync(new URL(path, import.meta.url), "utf8")
const normalize = text => text.replaceAll("’", "'").replace(/\s+/g, " ")
const spec = read("../design/src/001-functions.md").split("\n").find(line => line.startsWith("- **Import presentation.**"))
const cli = read("../user/src/setup/vibelang-cli.md").split("\n\n").find(text => text.startsWith("An import a declaration file adds,"))

function checkQuoteRule(text) {
  assert.ok(text, "published import-presentation paragraph")
  const normalized = normalize(text)
  assert.ok(normalized.includes("the file's first written import or export specifier"))
  assert.match(normalized, /double quotes if none exists|a file with none gets double quotes/)
}
test("the CLI and declaration spec retain first-specifier and no-specifier quote rules", () => {
  checkQuoteRule(spec)
  checkQuoteRule(cli)
})
test("fast-check: typography may vary while both quote decisions remain required", () => {
  fc.assert(fc.property(fc.constantFrom(spec, cli), fc.boolean(), fc.constantFrom(" ", "  ", "\n"), (text, curly, space) => {
    const changed = text.replaceAll("’", "'").replaceAll("'", curly ? "’" : "'").replaceAll(" ", space)
    checkQuoteRule(changed)
    assert.throws(() => checkQuoteRule(changed.replaceAll("first", "[removed]")))
    assert.throws(() => checkQuoteRule(changed.replaceAll("double", "[removed]")))
  }), { seed: 1104112, numRuns: 200 })
})
