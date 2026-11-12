import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// The site takes a docs page's first paragraph as its meta description and
// search snippet. A label such as "With Bun (optional):" there tells a reader
// nothing, so each description is a sentence.
const root = process.env.DOCS_CONTRACT_ROOT || fileURLToPath(new URL("../../", import.meta.url))
const pages = resolve(root, "site/src/pages")
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name)
  return entry.isDirectory() ? walk(path) : entry.name.endsWith(".mdx") ? [path] : []
})

test("every synced page description is a sentence, not a label", () => {
  const labels = []
  for (const path of walk(pages)) {
    const quoted = readFileSync(path, "utf8").match(/^description: (".*")$/m)?.[1]
    if (!quoted) continue
    const description = JSON.parse(quoted)
    if (!/[.?!)]$/.test(description) || description.split(/\s+/).length < 5) labels.push(`${relative(pages, path)}: ${description}`)
  }
  assert.deepEqual(labels, [])
})
