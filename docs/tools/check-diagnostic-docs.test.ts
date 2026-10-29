import { expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { diagnosticCodes, retiredByVips, undocumentedCodes } from "./check-diagnostic-docs"

const repo = resolve(import.meta.dir, "../..")
const docsRepo = process.env.DOCS_REVIEW_ROOT || repo
const walk = (root: string): string[] => readdirSync(root, { withFileTypes: true }).flatMap(entry => {
  const path = join(root, entry.name)
  return entry.isDirectory() ? walk(path) : [path]
})

test("extracts message declarations across files without counting references or comments", () => {
  expect(diagnosticCodes([
    "// EK1004 = message(1004, errorCategory, text)\nEK1004 = message(1004, errorCategory, text)",
    "\tEK4610 = message(4610, errorCategory, text)\nregistry[EK4610.Code] = EK4610",
    "var EK9100 = message(9100, warningCategory, text)"
  ])).toEqual(["EK1004", "EK4610", "EK9100"])
})

test("coverage requires a whole code and exempts the deferred name-resolution code and codes the VIPs retire", () => {
  expect(undocumentedCodes(["EK1006", "EK4407", "EK4610", "EK9100"], ["EK10060; EK4610: wait with d.await()"])).toEqual(["EK1006", "EK9100"])
  expect(undocumentedCodes(["EK2005"], [])).toEqual([])
  for (const reason of Object.values(retiredByVips)) expect(reason).toMatch(/VIP-\d+|no VIP/)
})

test("a retired code is still one the compiler registers", () => {
  const sources = walk(join(repo, "typescript/tsc/internal/vibelang"))
    .filter(path => path.endsWith(".go") && !path.endsWith("_test.go")).map(path => readFileSync(path, "utf8"))
  const registered = new Set(diagnosticCodes(sources))
  expect(Object.keys(retiredByVips).filter(code => !registered.has(code))).toEqual([])
})

test("every registered diagnostic has a user-doc reference", () => {
  const sources = walk(join(repo, "typescript/tsc/internal/vibelang"))
    .filter(path => path.endsWith(".go") && !path.endsWith("_test.go")).map(path => readFileSync(path, "utf8"))
  const pages = walk(join(docsRepo, "docs/user/src")).filter(path => path.endsWith(".md")).map(path => readFileSync(path, "utf8"))
  expect(undocumentedCodes(diagnosticCodes(sources), pages)).toEqual([])
})
