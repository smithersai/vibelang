import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

// The site's /proposals page says where each idea from the earlier design
// stands. Its statuses come from the VIP index, so they are checked against it.
const root = process.env.DOCS_CONTRACT_ROOT || fileURLToPath(new URL("../../", import.meta.url))
const read = path => readFileSync(resolve(root, path), "utf8")
const page = read("site/src/pages/proposals.mdx")
const index = read("docs/design/vips/README.md")

const slug = heading => heading.toLowerCase().replace(/`/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-")
const anchors = new Set([...page.matchAll(/^#{2,4} (.+)$/gm)].map(match => slug(match[1])))

const accepted = new Set(
  [...index.matchAll(/^\| \[(\d+)\]\([^)]*\) \| .* \| accepted \d{4}-\d{2}-\d{2} \|$/gm)].map(match => Number(match[1]))
)

const summary = (() => {
  const body = page.slice(page.indexOf("## Summary"), page.indexOf("\n## ", page.indexOf("## Summary") + 1))
  return [...body.matchAll(/^\| \[([^\]]+)\]\(#([^)]+)\) \| ([^|]+) \| ([^|]+) \|$/gm)]
    .map(([, name, anchor, stands, today]) => ({ name, anchor, stands: stands.trim(), today: today.trim() }))
})()

test("every proposals-page anchor the VIP index links to exists", () => {
  const links = [...index.matchAll(/proposals\.mdx#([a-z0-9-]+)/g)].map(match => match[1])
  for (const anchor of links) assert.ok(anchors.has(anchor), `VIP index links to missing #${anchor}`)
})

test("each summary row names its section and says where it stands by VIP", () => {
  assert.ok(summary.length > 0, "the summary table is missing")
  for (const row of summary) {
    assert.ok(anchors.has(row.anchor), `${row.name}: no section #${row.anchor}`)
    const vips = [...row.stands.matchAll(/VIP-(\d+)/g)].map(match => Number(match[1]))
    const stated = vips.length > 0 || /^(?:No VIP|Shipped\b)/.test(row.stands)
    assert.ok(stated, `${row.name}: "${row.stands}" names no VIP and does not say "No VIP" or "Shipped"`)
    if (/^(?:Shipped|Partly shipped)\b/.test(row.stands)) {
      for (const vip of vips) assert.ok(accepted.has(vip), `${row.name}: shipped through VIP-${vip}, which the index does not list as accepted`)
    }
  }
})

test("every VIP the page links to exists", () => {
  for (const [, file] of page.matchAll(/\]\(\/vips\/([0-9]{4}-[a-z0-9-]+)\)/g)) {
    assert.ok(existsSync(resolve(root, "docs/design/vips", file + ".md")), `no VIP file for /vips/${file}`)
  }
})

test("the page cites no unpublished decision-log entry or earlier-specification chapter", () => {
  assert.doesNotMatch(page, /\bdecisions? D\d+/)
  assert.doesNotMatch(page, /docs\/design\/history/)
  assert.doesNotMatch(page, /\bchapter \d+/i)
})
