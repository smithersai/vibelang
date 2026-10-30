import { expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultCompiler } from "./check-snippets"
import { runSnippets, runTestLimit } from "./run-snippets"

const compiler = defaultCompiler()

// The 0.0.1 compiler exits 0 but suppresses emit on warnings when
// noEmitOnError is true. The second project must emit its own entry anyway.
test.skipIf(!existsSync(compiler))("isolates run-mode output across projects when the second has a warning", async () => {
  const root = mkdtempSync(join(tmpdir(), "snippet-isolation-test-"))
  try {
    for (const [name, warning] of [["first", ""], ["second", 'function unusedFailure() { throw new Error("unused") }']] as const) {
      writeFileSync(join(root, `${name}.md`), [
        "```vibe", warning, `export function main() { Console.log("${name}") }`, `// Output: ${name}`, "```"
      ].join("\n"))
    }
    const output = join(root, "report.json")
    const { stdout, stderr, status } = await runSnippets(root, compiler, output)
    expect({ status, stderr, failures: stdout.split("\n").filter(line => line.includes("ENOENT")) })
      .toEqual({ status: 0, stderr: "", failures: [] })
    const report = JSON.parse(readFileSync(output, "utf8"))
    expect(report.execution).toEqual({ marked: 2, passed: 2, failed: 0 })
    expect(report.pages.map((page: any) => page.blocks[0].execution.stdout)).toEqual(["first\n", "second\n"])
  } finally { rmSync(root, { recursive: true, force: true }) }
}, runTestLimit)
