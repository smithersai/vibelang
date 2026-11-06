import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { check, checkAdoptedServiceShape, wholeShapeProduction } from "./check-grammar-authority.mjs"

const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")

const repository = fileURLToPath(new URL("../", import.meta.url))
const row = {
  hook: "parser/vibelang_service_type.go:Parser.parseServiceShapeDeclaration",
  form: "admission:service-shape",
  authority: "900-appendices.md#ServiceDeclaration",
  status: "admitted",
  reason: "VIP-9 permits the written whole shape with a required body."
}

test("current whole-shape service inventory agrees with its accepted grammar", () => {
  assert.deepEqual(check(repository), [])
})

test("the previous unsupported-form row is rejected", () => {
  const stale = { ...row, authority: "-", status: "pending", reason: "VIP-9 admits member body only, not service Name: Shape" }
  const problems = checkAdoptedServiceShape([stale], wholeShapeProduction)
  assert.ok(problems.some(problem => problem.includes("need ServiceDeclaration authority")))
  assert.ok(problems.some(problem => problem.includes("denies the accepted")))
})

test("authority and status mutations cannot turn the accepted form into a gap", () => {
  for (const authority of ["-", "001-functions.md", "900-appendices.md#DataDeclaration"])
    for (const status of ["pending", "recovery", "admitted", "support"])
      assert.ok(checkAdoptedServiceShape([{ ...row, authority, status }], wholeShapeProduction).length > 0)
  for (const authority of ["005-services.md", "900-appendices.md#ServiceDeclaration"])
    for (const status of ["admitted", "support"])
      assert.deepEqual(checkAdoptedServiceShape([{ ...row, authority, status }], wholeShapeProduction), [])
})

test("the grammar quote, row and parent dispatch explanation are independently checked", () => {
  assert.ok(checkAdoptedServiceShape([row], "").some(problem => problem.includes("production changed")))
  assert.ok(checkAdoptedServiceShape([], wholeShapeProduction).some(problem => problem.includes("no census row")))
  const parent = { ...row, hook: "parser/vibelang.go:Parser.parseServiceDeclaration", reason: "VIP-9; legacy control and custom shape branches remain pending" }
  assert.ok(checkAdoptedServiceShape([row, parent], wholeShapeProduction).some(problem => problem.startsWith(parent.hook)))
})

test("a separate bodyless recovery gap does not deny the accepted whole-shape form", () => {
  const gap = { ...row, hook: row.hook + "@missing-body", authority: "-", status: "pending", reason: "A bodyless declaration requires its own recovery diagnostic." }
  assert.deepEqual(checkAdoptedServiceShape([row, gap], wholeShapeProduction), [])
})

test("the dedicated check and mutation tests remain in the grammar gate", () => {
  const targets = readFileSync(new URL("../PACKAGE.ts", import.meta.url), "utf8")
  assert.match(targets, /"grammar-authority": grammarAuthority/)
  assert.match(targets, /node scripts\/check-grammar-authority\.mjs && node --test scripts\/grammar-authority\.test\.mjs/)
  assert.match(targets, /grammar-admission\.mjs --check"[\s\S]*?\[grammarAuthority\]/)
})

test("generated unrelated census rows cannot hide an unsupported whole-shape claim", () => {
  fc.assert(fc.property(
    fc.array(fc.record({
      form: fc.stringMatching(/^admission:[a-z]{1,12}$/),
      reason: fc.stringMatching(/^[a-z ]{1,60}$/)
    }), { maxLength: 25 }),
    fc.constantFrom("-", "001-functions.md", "900-appendices.md#DataDeclaration"),
    (unrelated, authority) => {
      const others = unrelated.map((entry, index) => ({
        ...row, ...entry, hook: "parser/other.go:Parser.other" + index
      }))
      assert.deepEqual(checkAdoptedServiceShape([...others, row], wholeShapeProduction), [])
      const stale = { ...row, authority, status: "pending" }
      assert.ok(checkAdoptedServiceShape([...others, stale], wholeShapeProduction)
        .some(problem => problem.startsWith(row.hook)))
    }
  ), { seed: 9009, numRuns: 100 })
})
