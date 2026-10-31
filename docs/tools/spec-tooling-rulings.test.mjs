import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter, read } from "./spec-witness.mjs"

// Loop round 1, OPUS-7: the orchestrator rulings of 2026-10-31 03:00 UTC (one
// --fix run reaches a fixed point) and 04:40 UTC item 3 (a missing
// vibelang-runtime is one error naming the package) are stated in chapter 7
// and VIP-34. FuzzFix and TestFixFixedPointQuoted read the first sentence.
test("chapter 7 states the --fix fixed point and the missing-runtime error", () => {
  const tooling = chapter("007-tooling")
  const codemods = tooling.split("\n").find((line) => line.startsWith("2. **Codemods.**"))
  assert.match(codemods, /One `vibelang --fix` run applies fixes until none applies; running it again changes nothing\. A run that has not converged within its pass limit reports the remaining fixes as an error\./)
  const diagnostics = tooling.split("\n").find((line) => line.startsWith("1. **Diagnostics.**"))
  assert.match(diagnostics, /imports `vibelang-runtime` and cannot resolve that package fails with one error naming it, TypeScript's `TS2307` for a missing module/)
  assert.match(diagnostics, /never reports the compiler-generated helpers the package provides as unresolved names/)
  const vip = read("docs/design/vips/0034-compiler-and-tooling.md")
  assert.match(vip, /\*\*Amended 2026-10-31: `--fix` reaches a fixed point, and a missing runtime is one error\.\*\*/)
})
