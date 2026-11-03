import { strict as assert } from "node:assert"
import { test } from "node:test"
import { censusSection, isGeneratedCensusSection } from "./grammar-census.mjs"

const row = (n, status = "support") => ({
  hook: "parser/vibelang_census.go:Parser.hook" + n,
  form: "admission:do", authority: status === "pending" ? "-" : "002-running.md",
  status, reason: "Implementation support metadata " + n
})
test("all census statuses render as validated implementation metadata", () => {
  const rows = ["admitted", "support", "recovery", "pending"].map((status, i) => row(i, status))
  assert.equal(isGeneratedCensusSection(censusSection(rows)), true)
  assert.equal(isGeneratedCensusSection(censusSection([{ ...row(1), reason: "metadata | text" }])), true)
  const before = structuredClone(rows)
  assert.equal(censusSection(rows), censusSection(structuredClone(rows)))
  assert.deepEqual(rows, before)
})
test("forged census frames and invalid records retain their evidence requirement", () => {
  const section = censusSection([row(1)])
  for (const invalid of [
    censusSection([]), censusSection([row(1), row(1)]),
    section.replace(row(1).reason, row(1).reason + " | forged column"),
    censusSection([{ ...row(1), authority: "-", status: "admitted" }]),
    censusSection([{ ...row(1), reason: "text\nAn operand must compile." }]),
    section.replace("(1 records)", "(0 records)"),
    section.replace("generate-grammar-admission.mjs", "manual.mjs"),
    section.replace("\n\n</details>", "\nA language rule must compile.\n\n</details>")
  ]) assert.equal(isGeneratedCensusSection(invalid), false)
})
