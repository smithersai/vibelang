import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultCompiler } from "./check-snippets"
import { runSnippets, runTestLimit } from "./run-snippets"

const compiler = defaultCompiler()
test.skipIf(!existsSync(compiler))("runs marked Vitest examples and fails test assertions even with matching stdout", async () => {
  const root = mkdtempSync(join(tmpdir(), "snippet-vitest-"))
  try {
    writeFileSync(join(root, "pass.md"), [
      "```vibe",
      'import { assert, it } from "@effect/vitest"',
      'it.live("prints the result") { Console.log("checked") }',
      'it.effect("checks the result") { assert.strictEqual(7, 7) }',
      '// Output: checked',
      '```'
    ].join("\n"))
    writeFileSync(join(root, "fail.md"), [
      "```ts", "// TypeScript (.ts)", "// fail.test.ts",
      'import { assert, it } from "@effect/vitest"',
      'it("checks the result", () => { console.log("checked"); assert.strictEqual(7, 8) })',
      '// Output: checked',
      '```'
    ].join("\n"))
    writeFileSync(join(root, "clock.md"), [
      "```vibe", 'import { assert, it } from "@effect/vitest"',
      'function delayed() { sleep("1 millis"); return "ready" }',
      'it.effect("registered assertion") { assert.strictEqual(7, 7) }', "```",
      "```vibe", '// run: Console.log(delayed())', 'const label = "excerpt"',
      '// Output: ready', "```"
    ].join("\n"))
    const report = join(root, "report.json")
    const { stderr, status } = await runSnippets(root, compiler, report)
    expect({ status, stderr }).toEqual({ status: 1, stderr: "" })
    const pages = JSON.parse(readFileSync(report, "utf8")).pages
    expect(pages.find((p: any) => p.page.endsWith("/clock.md")).blocks[1]).toMatchObject({ status: "ok", execution: { stdout: "ready\n", exitCode: 0 } })
    const block = (name: string) => pages.find((p: any) => p.page.endsWith(`/${name}.md`)).blocks[0]
    expect(block("pass")).toMatchObject({ status: "ok", execution: { stdout: "checked\n", exitCode: 0 } })
    expect(block("fail")).toMatchObject({ status: "fail", execution: { stdout: "checked\n", exitCode: 1, stderr: expect.stringContaining("AssertionError") } })
  } finally { rmSync(root, { recursive: true, force: true }) }
}, runTestLimit)
