import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// A guide teaches its topic before it lists rules. The site uses a page's
// first paragraph as its meta description and search snippet, so that
// paragraph says what the topic is, not which diagnostic a rejected form gets.
const root = process.env.DOCS_CONTRACT_ROOT || fileURLToPath(new URL("../../", import.meta.url))
const pages = resolve(root, "site/src/pages")
const guides = resolve(root, "docs/user/src")

const walk = (dir, ext) => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name)
  if (entry.isDirectory()) return walk(path, ext)
  return entry.name.endsWith(ext) ? [path] : []
})

const DIAGNOSTIC = /\b(?:EK|TS)\d{4}\b/

test("no synced docs page opens with a diagnostic code in its description", () => {
  const offenders = []
  for (const path of walk(pages, ".mdx")) {
    const rel = relative(pages, path)
    if (/^(?:vips|spec)\//.test(rel) || rel === "index.mdx" || rel === "proposals.mdx") continue
    const description = readFileSync(path, "utf8").match(/^description: (".*")$/m)?.[1]
    if (description && DIAGNOSTIC.test(JSON.parse(description))) offenders.push(`${rel}: ${JSON.parse(description)}`)
  }
  assert.deepEqual(offenders, [])
})

// Measured as the prose words between two consecutive headings or code
// blocks. The services and layers guides once ran 2,171 words of rules
// between their first sample and the next heading.
const MAX_PROSE_RUN = 600
const prose = text => {
  let words = 0, longest = 0, fence = false
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) { fence = !fence; longest = Math.max(longest, words); words = 0; continue }
    if (fence) continue
    if (line.startsWith("#")) { longest = Math.max(longest, words); words = 0; continue }
    words += line.split(/\s+/).filter(Boolean).length
  }
  return Math.max(longest, words)
}

test("requirements-management guides keep each prose run under a sample or heading short", () => {
  const dir = join(guides, "requirements-management")
  for (const path of walk(dir, ".md")) {
    const run = prose(readFileSync(path, "utf8"))
    assert.ok(run <= MAX_PROSE_RUN, `${relative(guides, path)}: ${run} words between two headings or samples (at most ${MAX_PROSE_RUN})`)
  }
})

test("the services guide teaches with samples before its rules reference", () => {
  const text = readFileSync(join(guides, "requirements-management/025-services.md"), "utf8")
  const rules = text.indexOf("\n## Rules\n")
  assert.ok(rules > 0, "025-services.md has no Rules section")
  const teaching = text.slice(0, rules)
  for (const section of teaching.split(/\n(?=## )/).slice(1)) {
    const heading = section.slice(3, section.indexOf("\n"))
    if (/^(?:Service keys|Default implementations|Coming from Effect)$/.test(heading)) continue
    assert.match(section, /```vibe\n/, `"${heading}" has no sample`)
  }
  const codes = new Set(teaching.replace(/^\/\/ expect-[a-z]+:.*$/gm, "").match(/\b(?:EK|TS)\d{4}\b/g) ?? [])
  assert.ok(codes.size <= 3, `the teaching sections name ${codes.size} diagnostics: ${[...codes].join(", ")}`)
})
