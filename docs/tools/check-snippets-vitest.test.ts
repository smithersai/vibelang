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
      'it.live("prints the result", effect () => { try Console.log("checked") })',
      'it.effect("checks the result", effect () => { assert.strictEqual(7, 7) })',
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
      'effect function delayed() { try sleep("1 millis"); return "ready" }',
      'it.effect("registered assertion", effect () => { assert.strictEqual(7, 7) })', "```",
      "```vibe", '// run: try Console.log(try delayed())', 'const label = "excerpt"',
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

// The deadline bounds the example, not Vitest's own startup: booting Vitest and
// transforming its imports took 1.6 to 9.5 s on a loaded host while the test
// itself took 20 to 212 ms, so a 10 s process deadline failed correct examples.
test.skipIf(!existsSync(compiler))("a Vitest example's deadline excludes Vitest startup and still stops a hung test", async () => {
  const root = mkdtempSync(join(tmpdir(), "snippet-vitest-deadline-"))
  try {
    writeFileSync(join(root, "quick.md"), [
      "```vibe", 'import { assert, it } from "@effect/vitest"',
      'it.effect("checks quickly", effect () => { assert.strictEqual(7, 7) })', "// Output:", "```"
    ].join("\n"))
    writeFileSync(join(root, "hung.md"), [
      "```vibe", 'import { it } from "@effect/vitest"',
      'it.effect("never finishes", effect () => { try Effect.never })', "// Output:", "```"
    ].join("\n"))
    const report = join(root, "report.json")
    // Vitest cannot start in 500 ms, so only the example is held to it.
    const { status } = await runSnippets(root, compiler, report, { deadline: 500 })
    expect(status).toBe(1)
    const pages = JSON.parse(readFileSync(report, "utf8")).pages
    const block = (name: string) => pages.find((p: any) => p.page.endsWith(`/${name}.md`)).blocks[0]
    expect(block("quick")).toMatchObject({ status: "ok", execution: { exitCode: 0, timedOut: false } })
    expect(block("hung")).toMatchObject({ status: "fail", reason: "Execution timed out after 500ms", execution: { timedOut: true, stderr: expect.stringContaining("Test timed out in 500ms") } })
  } finally { rmSync(root, { recursive: true, force: true }) }
}, runTestLimit)
