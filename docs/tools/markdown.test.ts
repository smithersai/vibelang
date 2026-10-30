import { expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { buildMarkdown } from "./markdown"

test("published Markdown omits harness directives and preserves example outputs", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-markdown-"))
  try {
    buildMarkdown(dir, { testCount: "123", testFiles: "4", kernelLines: "567" })
    const page = readFileSync(join(dir, "setup/vite.md"), "utf8")
    expect(page).not.toMatch(/^\s*\/\/ run:/m)
    expect(page).not.toMatch(/^\s*\/\/ pending:/m)
    expect(page).toContain("// Output: Hello, Vite!")
    expect(page).toContain('export effect function greet(name: string)')
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
    const spec = readFileSync(join(dir, "spec/000-intro.md"), "utf8")
    expect(spec).toMatch(/\bD\d+/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("Markdown rewrites prose links around fenced and inline code without rewriting the code", async () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-markdown-fixture-"))
  try {
    const put = (path: string, text: string) => {
      const target = join(root, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, text)
    }
    put("docs/user/inventory.md", [
      "## V4 sidebar in order", "### Guide",
      "- [Example](src/page.md)", "- [Target](src/target.md)", "- [Chapter](../design/src/chapter.md)"
    ].join("\n"))
    put("docs/user/llms-essentials.md", "Read the guide.")
    put("docs/user/src/target.md", "# Target")
    put("docs/design/src/chapter.md", "# Chapter")
    const tick = String.fromCharCode(96)
    const page = [
      "# Example", "", "[before](target.md)", "",
      tick + "[inline](missing.md)" + tick, "",
      tick.repeat(4) + "text", "[fenced](missing.md)", tick.repeat(3),
      "[still fenced](missing.md)", tick.repeat(4), "",
      "> ~~~~text", "> [quoted](missing.md)", "> ~~~",
      "> [still quoted](missing.md)", "> ~~~~", "",
      "[after](target.md#target)", "", "~~~text", "[unclosed](missing.md)"
    ].join("\n")
    put("docs/user/src/page.md", page)
    mkdirSync(join(root, "docs/tools"), { recursive: true })
    for (const file of ["markdown.ts", "sidebar.ts"]) copyFileSync(join(import.meta.dir, file), join(root, "docs/tools", file))
    mkdirSync(join(root, "site/scripts"), { recursive: true })
    copyFileSync(resolve(import.meta.dir, "../../site/scripts/user-docs.mjs"), join(root, "site/scripts/user-docs.mjs"))
    symlinkSync(join(import.meta.dir, "node_modules"), join(root, "docs/tools/node_modules"), "dir")
    const { buildMarkdown: buildFixture } = await import(join(root, "docs/tools/markdown.ts"))
    const destination = join(root, "public")
    buildFixture(destination, {})
    expect(readFileSync(join(destination, "page.md"), "utf8")).toBe(page
      .replace("[before](target.md)", "[before](https://vibelang.sh/target.md)")
      .replace("[after](target.md#target)", "[after](https://vibelang.sh/target.md#target)"))
    expect(readFileSync(join(root, "docs/user/src/page.md"), "utf8")).toBe(page)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
