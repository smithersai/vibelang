import { test } from "bun:test"
import fc from "fast-check"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")

for (const subpath of Object.keys(manifest.exports)) {
  const specifier = subpath === "." ? manifest.name : manifest.name + subpath.slice(1)
  test(`README names the package export ${specifier}`, () => {
    assert.ok(readme.includes(`\`${specifier}\``), `Document ${specifier} in README.md`)
  })
}


const specifiers = Object.keys(manifest.exports).map(subpath =>
  subpath === "." ? manifest.name : manifest.name + subpath.slice(1))
const missing = (text: string) => specifiers.filter(specifier => !text.includes("`" + specifier + "`"))

test("README export audit rejects omissions and prefix collisions", () => {
  assert.deepEqual(missing(readme), [])
  const retained = JSON.parse(readFileSync(new URL("./readme-export-regressions/experimental-companions.json", import.meta.url), "utf8"))
  for (const specifier of retained) {
    assert.ok(specifiers.includes(specifier))
    assert.deepEqual(missing(readme.replaceAll("`" + specifier + "`", "")), [specifier])
  }
  fc.assert(fc.property(fc.constantFrom(...specifiers), fc.integer({min: 0, max: 100000}), (specifier, suffix) => {
    const quoted = "`" + specifier + "`"
    const mutated = readme.replaceAll(quoted, "`" + specifier + "/child" + suffix + "`")
    assert.deepEqual(missing(mutated), [specifier])
  }), {seed: 74173, numRuns: 200})
})

test("README never tells a user to run vibelang --fix", () => {
  // The README is the npm package page. The compiler has no --fix option (TS5023), so
  // the page must not send a user to it.
  assert.doesNotMatch(readme, /vibelang(?:\s+[^\s`|]+)*\s+--fix\b/)
})
