// Chapter 7 publishes the 2026-10-31 04:40 UTC ruling, item 2: a
// repository's Oxlint JS-plugin rules run on .vibe files (loop round 1,
// OPUS-7). The migrate flow's tooling test is the implementation's check.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = process.env.SPEC_TOOLING_ROOT || fileURLToPath(new URL("../..", import.meta.url))
const read = path => readFileSync(resolve(root, path), "utf8")

test("chapter 7 runs a repository's Oxlint JS-plugin rules on .vibe files", () => {
  const item = read("docs/design/src/007-tooling.md").split("\n").find(line => line.startsWith("Type checkers use"))
  assert.ok(item, "chapter 7 tool integration")
  assert.match(item, /A repository's Oxlint JS-plugin rules run on `\.vibe` files wherever applicable to the source or emitted forms\./)
})

test("the migrate flow tests the Oxlint JS-plugin bridge the chapter requires", () => {
  const tooling = read(".smithers/flows/migrate/test/tooling.test.mjs")
  assert.match(tooling, /jsPlugins/)
})
