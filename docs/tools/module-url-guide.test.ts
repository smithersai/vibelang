import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultCompiler, extract, linkModules, runBlock } from "./check-snippets"

test("the platform module URL adapter is a working example", async () => {
  const text = readFileSync(new URL("../user/src/platform/platform-globals.md", import.meta.url), "utf8")
  const blocks = extract(text).filter(block => block.filename === "load-module.ts" || block.source.includes("function loadData("))
  const example = blocks.find(block => block.language === "vibe")!
  const temp = mkdtempSync(join(tmpdir(), "module-url-guide-"))
  try {
    linkModules(temp)
    const result = await runBlock(join(temp, "program"), blocks.map(block => ({ ...block, fragment: false, pending: undefined })), {
      ...example, status: "ok", diagnostics: [], output: "1",
      run: "const value = try loadData(); try Console.log(value.default)"
    }, defaultCompiler(), 30000)
    expect({ status: result.status, execution: result.execution?.status }).toEqual({ status: "ok", execution: "passed" })
    expect(example.fragment).toBe(false)
    expect(example.pending).toBeUndefined()
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}, 60000)
