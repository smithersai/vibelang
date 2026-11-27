import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { buildWiki, extractWikilinks, parseFrontmatter } from "../../.smithers/scripts/wiki.ts"

test("parseFrontmatter extracts title, tags, and body", () => {
  const parsed = parseFrontmatter("---\ntitle: Mythical History\ntags: [history, vips]\n---\n\n# Body\n")
  assert.equal(parsed.title, "Mythical History")
  assert.deepEqual(parsed.tags, ["history", "vips"])
  assert.equal(parsed.body.trim(), "# Body")
})

test("extractWikilinks skips fenced code blocks and strips aliases/headings", () => {
  const md = [
    "See [[Overview|Start]] and [[Compiler-Pipeline#Key Invariants]].",
    "```md",
    "Ignore [[Not-A-Link]] inside code blocks.",
    "```",
    "Also [[Mythical-History]]."
  ].join("\n")
  assert.deepEqual(extractWikilinks(md), ["Overview", "Compiler-Pipeline", "Mythical-History"])
})

test("buildWiki validates all real VibeLang docs/wiki notes with zero broken wikilinks", () => {
  const result = buildWiki()
  assert.deepEqual(result.errors, [])
  assert.ok(result.notes.length >= 10, "expected at least 10 curated wiki pages")
  assert.ok(result.notes.some((n) => n.path === "Overview.md"))
  assert.ok(result.notes.some((n) => n.path === "Mythical-History.md"))
  assert.ok((result.backlinks["Overview.md"] ?? []).length >= 3, "Overview should have backlinks")
  assert.ok((result.backlinks["Mythical-History.md"] ?? []).length >= 2, "Mythical-History should have backlinks")
})

test("buildWiki reports broken wikilinks accurately", () => {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-wiki-test-"))
  try {
    mkdirSync(join(scratch, "Sub"), { recursive: true })
    writeFileSync(join(scratch, "Overview.md"), "---\ntitle: Overview\n---\nSee [[Missing-Note]].\n")
    const result = buildWiki(scratch)
    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0], /broken wikilink \[\[Missing-Note\]\]/)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
