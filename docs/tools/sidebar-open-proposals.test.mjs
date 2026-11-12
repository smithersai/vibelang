import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

// A page that says its subject is an open proposal, not part of the language, must not sit
// in the sidebar under a plain feature name: a reader scanning "VibeLang features" took
// "Control operations and handlers" for a feature. The Experimental section's heading
// already says what its entries are.
const inventory = new URL("../user/inventory.md", import.meta.url)

function sidebarEntries() {
  const entries = []
  let inSidebar = false, section = ""
  for (const line of readFileSync(inventory, "utf8").split("\n")) {
    if (line.startsWith("## ")) inSidebar = line.startsWith("## V4 sidebar in order")
    if (!inSidebar) continue
    const heading = /^### (.+)$/.exec(line)
    if (heading) { section = heading[1]; continue }
    const entry = /^\s*- \[([^\]]+)\]\((src\/[^)]+\.md)\)/.exec(line)
    if (entry) entries.push({ section, label: entry[1], page: entry[2] })
  }
  return entries
}

function opening(page) {
  const lines = readFileSync(new URL("../user/" + page, inventory), "utf8").split("\n")
  const start = lines.findIndex(line => line.startsWith("# ")) + 1
  const paragraph = []
  for (const line of lines.slice(start)) {
    if (line.trim() === "") { if (paragraph.length) break; continue }
    paragraph.push(line.trim())
  }
  return paragraph.join(" ")
}

test("a sidebar entry for an open proposal says so in its label", () => {
  const entries = sidebarEntries()
  assert.ok(entries.length > 100, "expected the whole sidebar, found " + entries.length + " entries")
  const proposals = entries.filter(({ section, page }) => section !== "Experimental" && /\bopen proposal\b/i.test(opening(page)) && /\bnot part of the language\b/i.test(opening(page)))
  assert.ok(proposals.some(({ page }) => page.endsWith("111-control-operations-and-handlers.md")), "the handlers page must still open by calling them an open proposal")
  const unlabeled = proposals.filter(({ label }) => !/\bopen proposal\b/i.test(label) || !/\bnot in the alpha\b/i.test(label))
  assert.deepEqual(unlabeled.map(({ section, label }) => section + ": " + label), [])
})
