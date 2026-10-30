import { test, expect } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

// The site build rejects a dead link (vocs) or a fragment no heading or
// <a id> carries (check-site.ts), but it runs only in //:site-contrast, after
// merge. This reads the committed pages that sync-spec-docs.mjs generates from
// docs/design, so //:docs-tools catches the same links before merge.
const pages = resolve(import.meta.dir, "../../site/src/pages")
const sections = ["spec", "vips"]
const slug = (text: string) => text.toLowerCase().replace(/`/g, "").replace(/<[^>]+>/g, "")
  .replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s/g, "-")
const withoutFences = (text: string) => text.replace(/^```[^]*?^```/gm, "")
const withoutCode = (text: string) => withoutFences(text).replace(/(`+)[^]*?\1/g, "")

function load() {
  const found = new Map<string, { body: string; ids: Set<string> }>()
  for (const section of sections) {
    for (const name of readdirSync(resolve(pages, section)).filter(name => name.endsWith(".mdx"))) {
      const text = readFileSync(resolve(pages, section, name), "utf8"), body = withoutCode(text)
      const ids = new Set<string>(), counts = new Map<string, number>()
      for (const [, heading] of withoutFences(text).matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
        const base = slug(heading!)
        const count = counts.get(base) ?? 0
        counts.set(base, count + 1)
        ids.add(count ? base + "-" + count : base)
      }
      // An escaped tag (\\<a id=...>) renders as text, so only a literal tag counts.
      for (const [, id] of body.matchAll(/(?<!\\)<a id="([^"]+)"><\/a>/g)) ids.add(id!)
      found.set("/" + section + "/" + name.replace(/\.mdx$/, "").replace(/^index$/, ""), { body, ids })
    }
  }
  return found
}

test("generated spec and VIP pages link only to pages and fragments the site has", () => {
  const found = load()
  const dead: string[] = []
  for (const [route, { body }] of found) {
    for (const [, href] of body.matchAll(/\]\(([^\s)]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(href!)) continue
      if (/\.md(#|$)/.test(href!)) { dead.push(route + ": unconverted " + href); continue }
      const [path, fragment] = href!.split("#")
      const target = path ? found.get(path.replace(/\/$/, "") || path) ?? found.get(path) : found.get(route)
      if (!target) { if (sections.some(section => path!.startsWith("/" + section + "/"))) dead.push(route + ": missing page " + href); continue }
      if (fragment && !target.ids.has(decodeURIComponent(fragment))) dead.push(route + ": missing fragment " + href)
    }
  }
  expect(dead).toEqual([])
})
