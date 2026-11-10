import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import fc from "fast-check"
import { checkEntry } from "./rule-evidence"

const path = "docs/design/src/900-appendices.md"
const before = "| `EK1402` | retirement-target error, after the migration gate in chapter 007: retired Effect data receiver-method extension, such as `Option.some(1).map(f)`; use `Option.map(Option.some(1), f)` or the preserving `vibelang --fix` migration; refuse unsafe bindings or changed declarations | 14 | [Migration](007-tooling.md#legacy-data-receiver-methods) |"
const published = "| `EK1402` | retirement-target error, after the migration gate in chapter 007: retired Effect data receiver-method extension, such as `Option.some(1).map(f)`; use `Option.map(Option.some(1), f)` | 14 | [Migration](007-tooling.md#legacy-data-receiver-methods) |"
const inventory = () => readFileSync(import.meta.filename, "utf8")
const entry = (row: string) => ({ base: "base", head: "head", changes: [
  { path, before: "## Appendix B. Diagnostics\n\n" + before, after: "## Appendix B. Diagnostics\n\n" + row },
  { path: "docs/tools/vip-builtins-merge.test.ts", before: "", after: inventory() }
] })

test("published retirement authority keeps its exact promotion obligation", async () => {
  const result = await checkEntry(entry(published))
  expect(result.rules).toBe(1)
  expect(result.pending).toBe(1)
  expect(result.findings).toEqual([])
})

test("fast-check: a retirement witness cannot cover another diagnostic", async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 1403, max: 1499 }), async code => {
    const result = await checkEntry(entry(published.replace("EK1402", "EK" + code)))
    expect(result.rules).toBe(1)
    expect(result.pending).toBe(0)
    expect(result.findings).toHaveLength(1)
  }), { numRuns: 100, seed: 1402 })
})

// This records an obligation, not executable compiler coverage.
test.todo("rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | Published retirement authority; promotion coverage pending | present | | `EK1402` | retirement-target error, after the migration gate in chapter 007: retired Effect data receiver-method extension, such as `Option.some(1).map(f)`; use `Option.map(Option.some(1), f)` | 14 | [Migration](007-tooling.md#legacy-data-receiver-methods) |")
