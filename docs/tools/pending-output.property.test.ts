import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defaultCompiler, extract, linkModules, retirable } from "./check-snippets"

test("native Effect main prints generated output; retirement accepts exact output only", async () => {
  const compiler = defaultCompiler()
  const message = fc.array(fc.constantFrom("a", "b", "é", "雪", "'", "\"", "\\"), { minLength: 1, maxLength: 8 })
    .map(letters => "message_" + letters.join("") + "!")
  // The native program emits the full generated batch; two output
  // expectations exercise acceptance and refusal.
  await fc.assert(fc.asyncProperty(fc.array(message, { minLength: 32, maxLength: 32 }), async messages => {
    const root = mkdtempSync(join(tmpdir(), "pending-output-property-"))
    try {
      linkModules(root)
      const source = "export effect function main() {\n" +
        messages.map(value => "  try Console.log(" + JSON.stringify(value) + ")").join("\n") + "\n}"
      for (const label of ["exact", "wrong"]) {
        const expected = messages.map((value, index) =>
          label === "wrong" && index === messages.length - 1 ? "not_" + value : value)
        const markdown = ["```vibe", "// pending: VIP-1", source,
          ...expected.map(value => "// Output: " + value), "```"].join("\n")
        const blocks = extract(markdown)
        mkdirSync(join(root, label))
        const refused = new Map<number, string>()
        const retired = await retirable(join(root, label), blocks, "/native-output.md", compiler, 10_000, refused)
        expect(retired.map(block => block.number)).toEqual(label === "exact" ? [1] : [])
        if (label === "exact") expect([...refused]).toEqual([])
        else expect([...refused.values()].join("\n")).toContain("stdout mismatch")
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 146, numRuns: 1, endOnFailure: true })
})
