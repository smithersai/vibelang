import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// A docs page's title is its browser tab, its search result and its share
// title, with " | VibeLang" appended. "Introduction | VibeLang" says nothing,
// and "Metrics in VibeLang | VibeLang" repeats the name.
const root = process.env.DOCS_CONTRACT_ROOT || fileURLToPath(new URL("../../", import.meta.url))
const pages = resolve(root, "site/src/pages")
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name)
  return entry.isDirectory() ? walk(path) : entry.name.endsWith(".mdx") ? [path] : []
})
const titles = walk(pages)
  .map(path => ({ page: relative(pages, path), title: readFileSync(path, "utf8").match(/^title: (".*")$/m)?.[1] }))
  .filter(({ page, title }) => title && !/^(?:vips|spec)\//.test(page) && page !== "index.mdx" && page !== "proposals.mdx")
  .map(({ page, title }) => ({ page, title: JSON.parse(title) }))

test("every docs page title is unique", () => {
  const seen = new Map()
  const repeats = []
  for (const { page, title } of titles) {
    if (seen.has(title)) repeats.push(`${title}: ${seen.get(title)} and ${page}`)
    else seen.set(title, page)
  }
  assert.deepEqual(repeats, [])
})

test("no docs page title ends with the site name", () => {
  assert.deepEqual(titles.filter(({ title }) => / in VibeLang$/.test(title)).map(({ page, title }) => `${page}: ${title}`), [])
})
