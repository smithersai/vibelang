import { expect, test } from "bun:test"
import fc from "fast-check"
import { marked } from "marked"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

function jumps(markdown: string) {
  let previous = 0
  const errors: { text: string; from: number; to: number }[] = []
  for (const token of marked.lexer(markdown)) {
    if (token.type !== "heading") continue
    if (previous && token.depth > previous + 1) errors.push({ text: token.text, from: previous, to: token.depth })
    previous = token.depth
  }
  return errors
}
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith(".md") ? [join(dir, entry.name)] : [])
}
test("guide and specification sections do not skip a heading level", () => {
  const roots = ["../user/src", "../design/src"].map(path => join(import.meta.dir, path))
  // Site sync publishes top-level VIP pages; nested folders vendor external proposals.
  const vips = join(import.meta.dir, "../design/vips")
  const pages = [...roots.flatMap(files), ...readdirSync(vips).filter(file => file.endsWith(".md")).map(file => join(vips, file))]
  const problems = pages.flatMap(file => jumps(readFileSync(file, "utf8")).map(problem => ({ file: file.slice(file.indexOf("/docs/") + 1), ...problem })))
  expect(problems).toEqual([])
})
test("heading checks ignore code fences containing arbitrary heading levels", () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 6 }), { maxLength: 40 }), levels => {
    const code = levels.map(level => "#".repeat(level) + " shown as code").join("\n")
    expect(jumps("# Page\n\n~~~markdown\n" + code + "\n~~~\n\n## Section")).toEqual([])
  }), { numRuns: 200 })
})
test("heading checks distinguish valid transitions and skipped parents", () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: -1, max: 1 }), { maxLength: 40 }), steps => {
    let level = 1
    const headings = ["# Page", ...steps.map(step => {
      level = Math.max(1, Math.min(6, level + step))
      return "#".repeat(level) + " Section"
    })]
    expect(jumps(headings.join("\n\n"))).toEqual([])
  }), { numRuns: 200 })
  fc.assert(fc.property(fc.integer({ min: 1, max: 4 }), from => {
    const markdown = "#".repeat(from) + " Parent\n\n" + "#".repeat(from + 2) + " Child"
    expect(jumps(markdown)).toEqual([{ text: "Child", from, to: from + 2 }])
  }), { numRuns: 100 })
})
