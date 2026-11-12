// Every output a published sample shows comes from code the reader can see:
// the snippet checker's `// run:` statements appear in the published block,
// and an empty `// Output:` marker (an assertion of silence) does not.
import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve } from "node:path"
import { extract, markdownPages } from "./check-snippets"
import { buildMarkdown } from "./markdown"
import { publishRunDirectives } from "../../site/scripts/user-docs.mjs"

const repo = resolve(import.meta.dir, "../..")
const src = join(repo, "docs/user/src")

function codeBlocks(text: string): string[] {
  const blocks: string[] = []
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(lines[i])?.[1]
    if (!fence) continue
    const close = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`)
    const body: string[] = []
    while (++i < lines.length && !close.test(lines[i])) body.push(lines[i])
    blocks.push(body.join("\n"))
  }
  return blocks
}

// Compare code without layout: comment markers, whitespace and semicolons.
const bare = (code: string) => code.replace(/^\s*\/\/ ?(?:Run(?: in an effect function)?:)?/gm, "").replace(/[\s;]+/g, "")

const runs = markdownPages(src).flatMap(page => extract(readFileSync(page, "utf8"))
  .filter(block => block.run !== undefined)
  .map(block => ({ page: relative(src, page), line: block.line, run: block.run!, firstLine: block.firstLine })))

function hidden(published: (rel: string) => string | undefined) {
  const missing: string[] = []
  for (const { page, line, run, firstLine } of runs) {
    const text = published(page)
    if (text === undefined) continue
    const shown = codeBlocks(text).some(block => block.includes(firstLine.trim()) && bare(block).includes(bare(run)))
    if (!shown) missing.push(`${page}:${line} runs \`${run.slice(0, 80)}\` but the published block does not show it`)
  }
  return missing
}

function checkerOnly(published: (rel: string) => string | undefined) {
  const found: string[] = []
  for (const page of markdownPages(src)) {
    const rel = relative(src, page), text = published(rel)
    if (text === undefined) continue
    for (const block of codeBlocks(text)) for (const line of block.split("\n")) {
      if (/^\s*\/\/\s*(?:run:|pending-decision:|pending:\s*VIP-)/.test(line) || /^\s*\/\/ Output:\s*$/.test(line)) found.push(`${rel}: ${line.trim()}`)
    }
  }
  return found
}

test("the docs have run lines to check", () => {
  expect(runs.length).toBeGreaterThan(500)
})

test("every site page shows the statements that produce its outputs", () => {
  const site = (rel: string) => {
    const file = join(repo, "site/src/pages", rel.replace(/\.md$/, ".mdx"))
    return existsSync(file) ? readFileSync(file, "utf8") : undefined
  }
  expect(hidden(site)).toEqual([])
  expect(checkerOnly(site)).toEqual([])
})

test("every Markdown copy shows the statements that produce its outputs", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-run-lines-"))
  try {
    buildMarkdown(dir, { testCount: "123", testFiles: "4", kernelLines: "567" })
    const copy = (rel: string) => existsSync(join(dir, rel)) ? readFileSync(join(dir, rel), "utf8") : undefined
    expect(hidden(copy)).toEqual([])
    expect(checkerOnly(copy)).toEqual([])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("a run line shows above the first output, split into statements", () => {
  const page = publishRunDirectives([
    "```vibe",
    "// run: provide Clock = fixed { try Clock.set(0); try Console.log(try read()) }; try Console.log(\"a; b\")",
    "// pending: VIP-1",
    "effect function read() { return 1 }",
    "// number!!",
    "// Output: 1",
    "// Output: a; b",
    "```",
    "",
    "```ts",
    "// run: console.log(value)",
    "const value = 1",
    "```",
    "",
    "```output",
    "1",
    "```",
    "",
    "```vibe",
    "it.effect(\"passes\", () => effect {})",
    "// Output:",
    "```"
  ].join("\n"))
  expect(page).toBe([
    "```vibe",
    "effect function read() { return 1 }",
    "// number!!",
    "// Run in an effect function:",
    "//   provide Clock = fixed {",
    "//     try Clock.set(0)",
    "//     try Console.log(try read())",
    "//   }",
    "//   try Console.log(\"a; b\")",
    "// Output: 1",
    "// Output: a; b",
    "```",
    "",
    "```ts",
    "const value = 1",
    "// Run: console.log(value)",
    "```",
    "",
    "```output",
    "1",
    "```",
    "",
    "```vibe",
    "it.effect(\"passes\", () => effect {})",
    "```"
  ].join("\n"))
})
