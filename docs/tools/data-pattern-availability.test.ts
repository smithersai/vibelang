import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { extract } from "./check-snippets"

test("the Data guide describes its runnable object patterns as available", () => {
  const text = readFileSync(new URL("../user/src/data-types/073-data.md", import.meta.url), "utf8")
  const patterns = extract(text).filter(block => /when \{ _tag:/.test(block.source))
  expect(patterns.length).toBeGreaterThan(0)
  for (const block of patterns) {
    expect(block.pending).toBeUndefined()
    expect(block.output).toBeDefined()
  }
  expect(text).not.toMatch(/(?:support|implementation)[^\n.]*object patterns[^\n.]*arrives/i)
})
