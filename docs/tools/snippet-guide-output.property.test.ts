import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultCompiler, extract, linkModules, retirable } from "./check-snippets"
import { runSnippets, runTestLimit } from "./run-snippets"

// rule-evidence: docs/design/vips/0026-top-level-and-main.md#decision
const startupRule = "There is no magic entry point. A function named `main` is an ordinary function, and you call a runner yourself, exactly as in Effect TS."

test("output assertions follow the explicit startup rule", () => {
  expect(readFileSync(new URL("../design/vips/0026-top-level-and-main.md", import.meta.url), "utf8")).toContain(startupRule)
})

test("the snippet-checker guide's logging example prints its declared output", async () => {
  const guide = readFileSync(new URL("./README.md", import.meta.url), "utf8")
  const section = guide.split("## Running examples\n")[1]!.split("\n## ")[0]!
  const [block, ...rest] = extract(section)
  expect(rest).toEqual([])
  expect(block.output).toBe("Hello, Ada!")
  const root = mkdtempSync(join(tmpdir(), "snippet-guide-output-"))
  try {
    writeFileSync(join(root, "guide.md"), section)
    const report = join(root, "report.json")
    const result = await runSnippets(root, defaultCompiler(), report)
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" })
    const checked = JSON.parse(readFileSync(report, "utf8"))
    expect(checked.execution).toEqual({ marked: 1, passed: 1, failed: 0 })
    expect(checked.pages[0].blocks[0].execution.stdout).toBe("Hello, Ada!\n")
  } finally { rmSync(root, { recursive: true, force: true }) }
}, runTestLimit)


test("run hooks execute their Effects and keep exact generated output", async () => {
  const compiler = defaultCompiler()
  const message = fc.array(fc.constantFrom("a", "b", "é", "雪", "'", '"', "\\"), { minLength: 1, maxLength: 8 })
    .map(letters => "message_" + letters.join("") + "!")
  await fc.assert(fc.asyncProperty(fc.array(message, { minLength: 32, maxLength: 32 }), async messages => {
    const root = mkdtempSync(join(tmpdir(), "snippet-hook-output-"))
    try {
      linkModules(root)
      const source = "export effect function main() {\n" +
        messages.map(value => "  try Console.log(" + JSON.stringify(value) + ")").join("\n") + "\n}"
      for (const runs of [true, false]) for (const label of ["exact", "wrong"]) {
        const expected = messages.map((value, index) =>
          label === "wrong" && index === messages.length - 1 ? "not_" + value : value)
        const markdown = ["```vibe", "// pending: VIP-1",
          "// run: " + (runs ? "try " : "") + "main()", source,
          ...expected.map(value => "// Output: " + value), "```"].join("\n")
        const dir = join(root, (runs ? "run-" : "cold-") + label)
        mkdirSync(dir)
        const refused = new Map<number, string>()
        const retired = await retirable(dir, extract(markdown), "/hook-output.md", compiler, 10_000, refused)
        if (runs && label === "exact") {
          expect({ retired: retired.map(block => block.number), refused: [...refused] }).toEqual({ retired: [1], refused: [] })
        } else {
          expect(retired).toEqual([])
          expect(refused.size).toBe(1)
          if (runs) expect([...refused.values()].join("\n")).toContain("stdout mismatch")
        }
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 345, numRuns: 1, endOnFailure: true })
}, runTestLimit)
