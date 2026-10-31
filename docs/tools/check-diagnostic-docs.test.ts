import { expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { diagnosticCodes, importedLintRules, pendingRegistryCodes, retiredByVips, undocumentedCodes } from "./check-diagnostic-docs"

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

test("Appendix B codes, including leading zeros, have matching registry declarations", () => {
  const appendix = readFileSync(join(repo, "docs/design/src/900-appendices.md"), "utf8")
    .split("## Appendix B. Diagnostics")[1].split("\n## Appendix C.")[0]
  const assigned = [...appendix.matchAll(/^\| `?(EK(?:38[0-9]{2,}|[0-9]{4}))`? \|/gm)].map(match => match[1])
  expect(assigned.length).toBeGreaterThan(0)
  const sources = walk(join(repo, "typescript/tsc/internal/vibelang"))
    .filter(path => path.endsWith(".go") && !path.endsWith("_test.go")).map(path => readFileSync(path, "utf8"))
  const names = sources.flatMap(source => [...source.matchAll(/^\s*(?:var\s+)?(EK\d+)\s*=\s*(?:message\(|&Message\{)/gm)].map(match => match[1]))
  expect(names.length).toBe(new Set(names).size)
  const imported = importedLintRules(readFileSync(join(repo, "typescript/tsc/internal/core/vibe_lint_codes.go"), "utf8"))
  const inventory = JSON.parse(readFileSync(join(repo, "docs/design/inventory/lint-codes.json"), "utf8"))
  const sorted = (rules: { code: string, rule: string }[]) => rules.map(({ code, rule }) => ({ code, rule })).sort((a, b) => a.code.localeCompare(b.code))
  expect(sorted(imported)).toEqual(sorted(inventory.rules))
  const declared = new Set(diagnosticCodes(sources))
  for (const { code } of imported) {
    expect(declared.has(code)).toBe(false)
    declared.add(code)
  }
  // Use the native registry test's owned pending entries so their owner
  // removes each exception once, in the same commit as its registration.
  const registryTest = readFileSync(join(repo, "typescript/tsc/internal/vibelang/diagnostics_test.go"), "utf8")
  expect(assigned.filter(code => !declared.has(code)).sort()).toEqual(pendingRegistryCodes(registryTest))
  for (const source of sources) {
    for (const match of source.matchAll(/^\s*(?:var\s+)?(EK\d+)\s*=\s*message\((\d+),/gm)) {
      expect(Number(match[1].slice(2))).toBe(Number(match[2]))
    }
  }
})

test("pending registry extraction counts map keys, not numbers in comments or reasons", () => {
  const source = "var specAhead = map[int32]string{\n\t// VIP-7: an existing jump rule\n\t706: renumbering, /* 8: */ 1602: \"9: a reason\", // 10: trailing\n\t704: `11:`,\n}"
  expect(pendingRegistryCodes(source)).toEqual(["EK0704", "EK0706", "EK1602"])
})

test("imported registry extraction preserves whole codes and ignores other Go maps", () => {
  const source = 'var Other = map[string]string{\n "EK3999": "unrelated",\n}\n' +
    'var VibeImportedLintCodes = map[string]string{\n "EK3810": "short",\n "EK38100": "long",\n}\n'
  expect(importedLintRules(source)).toEqual([{ code: "EK3810", rule: "short" }, { code: "EK38100", rule: "long" }])
  expect(() => importedLintRules(source.replace('"EK38100"', '"EK3810"'))).toThrow(/duplicate/)
  expect(() => importedLintRules(source.replace('"EK38100"', '"EK39000"'))).toThrow(/Invalid/)
  expect(() => importedLintRules("")).toThrow(/Missing/)
})
