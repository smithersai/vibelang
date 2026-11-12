import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

// A reader of the site home learns what the alpha supports and what is
// experimental before following any link.
const root = process.env.DOCS_CONTRACT_ROOT || fileURLToPath(new URL("../../", import.meta.url))
const read = path => readFileSync(resolve(root, path), "utf8")

test("the home page says what the alpha supports and what is experimental", () => {
  const home = read("site/src/pages/index.mdx")
  const next = home.slice(home.indexOf("## Where to go next"))
  assert.match(next, /The alpha supports the language the accepted \[VIPs\]\(\/vips\/\)/)
  assert.match(next, /are experimental: each can change or be removed in any release/)
  assert.match(next, /\[What is in the alpha\]\(\/setup\/alpha\) lists them/)
})

test("the page the home page links to exists in every build", () => {
  // The release notes show sections only up to npm latest, so an anchor into an unpublished version's notes is
  // missing on the live site until that version is published; the alpha page always exists.
  assert.match(read("docs/user/src/setup/alpha.md"), /\S/)
  assert.match(read("site/src/pages/setup/alpha.mdx"), /\S/)
})
