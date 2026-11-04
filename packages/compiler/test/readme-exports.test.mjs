import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")

for (const subpath of Object.keys(manifest.exports)) {
  const specifier = subpath === "." ? manifest.name : manifest.name + subpath.slice(1)
  test(`README names the package export ${specifier}`, () => {
    assert.ok(readme.includes(`\`${specifier}\``), `Document ${specifier} in README.md`)
  })
}
