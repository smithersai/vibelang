import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildMarkdown } from "./markdown"

test("published Markdown omits harness directives and preserves example outputs", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-markdown-"))
  try {
    buildMarkdown(dir, { testCount: "123", testFiles: "4", kernelLines: "567" })
    const page = readFileSync(join(dir, "setup/vite.md"), "utf8")
    expect(page).not.toMatch(/^\s*\/\/ run:/m)
    expect(page).not.toMatch(/^\s*\/\/ pending:/m)
    expect(page).toContain("// Output: Hello, Vite!")
    expect(page).toContain('export effect greet(name: string)')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("user Markdown hides decision annotations while the specification keeps them", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-decisions-"))
  try {
    buildMarkdown(dir, { testCount: "123", testFiles: "4", kernelLines: "567" })
    const page = readFileSync(join(dir, "vibelang-features/115-cheat-sheet.md"), "utf8")
    expect(page).not.toMatch(/\bD\d+/)
    expect(page).toContain("**Errors**.")
    expect(page).toContain("[do expressions](https://github.com/tc39/proposal-do-expressions)")
    const spec = readFileSync(join(dir, "spec/900-appendices.md"), "utf8")
    expect(spec).toMatch(/\bD\d+/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
