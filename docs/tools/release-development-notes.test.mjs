import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { renderSiteRelease } from "./published-site.mjs"

const notes = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
const releases = notes.split(/^## /m).slice(1)
const section = version => releases.find(release => release.split("\n")[0].replace(/ \(unreleased\)$/, "") === version)

test("the release after 0.0.13 retains the published baseline and later documentation fixes", () => {
  const development = section("0.0.14")
  const published = section("0.0.13")
  assert.ok(development, "retain a separate section for changes after 0.0.13")
  assert.ok(published?.startsWith("0.0.13\n"), "0.0.13 is published")
  assert.ok(releases.indexOf(development) < releases.indexOf(published))
  assert.match(development, /^### Bugs fixed since 0\.0\.13$/m)
  for (const symptom of [
    "The experimental opt-in section implied",
    "Searching the website for `install`",
    "The Proposals page called `.vibex` files unbuilt"
  ]) {
    assert.ok(development.includes(symptom), symptom + " belongs after publication")
    assert.ok(!published.includes(symptom), symptom + " did not ship in 0.0.13")
  }
  assert.ok(published.includes("Strict TypeScript configurations importing entries such as `vibelang/eslint`"),
    "retain the declaration fix shipped in 0.0.13")
})

test("published site release notes omit fixes from the next development section", () => {
  for (const path of ["setup/release-notes.md", "setup/release-notes.mdx"]) {
    const output = renderSiteRelease(path, notes, { compiler: { version: "0.0.13" } })
    assert.equal(output, notes.split(/^## 0\.0\.13\n/m)[0].split(/^## /m)[0] +
      "## 0.0.13\n" + notes.split(/^## 0\.0\.13\n/m)[1])
    assert.doesNotMatch(output, /^## 0\.0\.14/m)
    assert.ok(!output.includes("The experimental opt-in section implied"))
  }
})
