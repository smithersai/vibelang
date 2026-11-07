import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultCompiler, extract, linkModules, runBlock } from "./check-snippets"

test("the throw-expression guide demonstrates and runs a conditional expression failure", async () => {
  const page = readFileSync(new URL("../user/src/error-management/014-expected-errors.md", import.meta.url), "utf8")
  const blocks = extract(page)
  const example = blocks.find(block => block.source.includes("function port("))!
  expect(example.source).toContain('return env.get("PORT") ?? throw new MissingPort()')
  const temp = mkdtempSync(join(tmpdir(), "throw-expression-guide-"))
  try {
    linkModules(temp)
    const result = await runBlock(join(temp, "port"), blocks, { ...example, status: "ok", diagnostics: [] }, defaultCompiler(), 10000)
    expect({ status: result.status, reason: result.reason, execution: result.execution }).toMatchObject({
      status: "ok", execution: { phase: "run", status: "passed", stdout: "3000\nMissingPort\n", exitCode: 0 }
    })
  } finally { rmSync(temp, { recursive: true, force: true }) }
})
