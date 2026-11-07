import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

test("the Effect upgrade changes the transitive pin before installing or checking", () => {
  const notes = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
  const release = notes.split("## 0.0.11\n")[1]?.split(/^## /m)[0]
  assert.ok(release, "retain the published upgrade instructions")
  const pin = release.indexOf('"@effect/platform-node-shared": "4.1.1"')
  const npm = release.indexOf("npm install --save-exact")
  const bun = release.indexOf("bun add --exact")
  assert.ok(pin >= 0 && npm >= 0 && bun >= 0)
  assert.ok(pin < npm && pin < bun, "update the helper override before either package manager installs the new Effect")
})
