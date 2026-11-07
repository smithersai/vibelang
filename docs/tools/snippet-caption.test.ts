import { expect, test } from "bun:test"
import fc from "fast-check"
import { readFileSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { blockFilenames, extract, defaultCompiler, linkModules, runBlock } from "./check-snippets"
import { checkProperty } from "../../scripts/testing/property.mjs"

test("a fragment caption does not rename the cheat sheet's TypeScript companion", () => {
  const blocks = extract(readFileSync(new URL("../user/src/vibelang-features/115-cheat-sheet.md", import.meta.url), "utf8"))
  const companion = blocks.find(block => block.filename === "links.ts" && !block.fragment)!
  expect(companion).toBeDefined()
  expect(blockFilenames(blocks).get(companion.number)).toBe("links.ts")
})

test("fragment captions preserve complete module names in either order", async () => {
  await checkProperty(fc, {
    name: "snippet-fragment-captions",
    regressions: new URL("./testdata/snippet-captions/", import.meta.url),
    rule: "A fragment is not a source module and cannot rename a complete companion",
    command: "bun test docs/tools/snippet-caption.test.ts",
    arbitrary: fc.record({
      segments: fc.array(fc.stringMatching(/^[a-z][a-z0-9_-]{0,8}$/), { minLength: 1, maxLength: 3 }),
      fragments: fc.integer({ min: 1, max: 5 }),
      before: fc.boolean(),
      language: fc.constantFrom("ts", "vibe")
    }),
    check({ segments, fragments, before, language }) {
      const filename = segments.join("/") + "." + language
      const complete = ["```" + language, "// " + filename, "export const value = 42", "```"].join("\n")
      const fragment = ["```" + language, "// fragment", "// " + filename, "export const value = ...", "```"].join("\n")
      const pieces = Array(fragments).fill(fragment)
      if (before) pieces.push(complete)
      else pieces.unshift(complete)
      const blocks = extract(pieces.join("\n"))
      const names = blockFilenames(blocks)
      const module = blocks.find(block => !block.fragment)!
      expect(names.get(module.number)).toBe(filename)
      expect(new Set(names.values()).size).toBe(blocks.length)
      for (const block of blocks.filter(block => block.fragment)) expect(names.get(block.number)).not.toBe(filename)
    }
  })
})


test("a complete companion example compiles and runs beside its comparison fragment", async () => {
  const blocks = extract(readFileSync(new URL("../user/src/vibelang-features/115-cheat-sheet.md", import.meta.url), "utf8"))
  const companion = blocks.find(block => block.filename === "links.ts" && !block.fragment)!
  const fragment = blocks.find(block => block.filename === "links.ts" && block.fragment)!
  const caller = blocks.find(block => block.run?.includes('linked(".")'))!
  const runnable = { ...caller, pending: undefined, fragment: false }
  const temp = mkdtempSync(join(tmpdir(), "snippet-caption-"))
  try {
    linkModules(temp)
    const result = await runBlock(join(temp, "project"), [companion, fragment, runnable], {
      ...runnable, status: "ok", diagnostics: []
    }, defaultCompiler(), 10000)
    expect({ reason: result.reason, execution: result.execution }).toMatchObject({
      reason: undefined, execution: { status: "passed", stdout: "false\n", exitCode: 0, timedOut: false }
    })
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}, 60000)
