import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { compareDeclarations } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-d298-missing-baseline.json", import.meta.url)))
const quote = "Every declaration gate compares exported names, type identity and doc comments through the shared checker."

test("t3code D298: one absent baseline target cannot erase a sibling spelling receipt", () => {
  assert.ok(readFileSync(new URL("../rules.md", import.meta.url), "utf8").includes(quote))
  const root = mkdtempSync(join(tmpdir(), "t3code-d298-"))
  try {
    fc.assert(fc.property(fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/), fc.boolean(), (name, reverse) => {
      const before = corpus.before.replaceAll(corpus.available, name)
      const after = corpus.after.replaceAll(corpus.available, name)
      for (const [side, text] of [["before", before], ["after", after]]) {
        const dir = join(root, side)
        rmSync(dir, { recursive: true, force: true }); mkdirSync(dir)
        writeFileSync(join(dir, "index.d.ts"), reverse ? text.trim().split("\n").reverse().join("\n") + "\n" : text)
        writeFileSync(join(dir, name + ".d.ts"), "export declare const value: number;\n")
      }
      const result = compareDeclarations(ts, join(root, "before"), join(root, "after"))
      assert.deepEqual(result.excused.map(x => [x.before, x.after]), [["./" + name + ".ts", "./" + name + ".js"]])
      assert.equal(result.identical, false, "an unresolved API still cannot be certified")
      assert.equal(result.comparisonComplete, false)
    }), { seed: 2981103, numRuns: 8, examples: [[corpus.available, false], [corpus.available, true]] })
    // A fully resolved sibling with a changed type must also remain a failure.
    for (const [side, type] of [["before", "number"], ["after", "string"]]) {
      writeFileSync(join(root, side, "index.d.ts"), 'export * from "./leaf.' + (side === "before" ? "ts" : "js") + '";\n')
      writeFileSync(join(root, side, "leaf.d.ts"), "export declare const changed: " + type + ";\n")
    }
    assert.equal(compareDeclarations(ts, join(root, "before"), join(root, "after")).identical, false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
