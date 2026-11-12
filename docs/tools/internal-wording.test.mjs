import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// User docs describe the release a reader installs. Phrases that point at the
// repository's working state ("this source version") mean nothing to them.
const root = process.env.DOCS_CONTRACT_ROOT || fileURLToPath(new URL("../../", import.meta.url))
const guides = resolve(root, "docs/user/src")
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name)
  return entry.isDirectory() ? walk(path) : entry.name.endsWith(".md") ? [path] : []
})

test("user docs name a release, not the repository's source version", () => {
  const hits = walk(guides)
    .filter(path => !path.endsWith("release-notes.md"))
    .flatMap(path => readFileSync(path, "utf8").split("\n").flatMap((line, i) =>
      /\b(?:this|the current) source version\b/i.test(line) ? [`${relative(guides, path)}:${i + 1}`] : []))
  assert.deepEqual(hits, [])
})
