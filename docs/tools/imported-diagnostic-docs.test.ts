import { expect, test } from "bun:test"
import fc from "fast-check"
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkDiagnosticDocs, importedLintRules, undocumentedCodes } from "./check-diagnostic-docs"

const repo = join(import.meta.dir, "../..")
const rules = importedLintRules(readFileSync(join(repo, "typescript/tsc/internal/core/vibe_lint_codes.go"), "utf8"))

test("the diagnostic reference names every imported rule with its whole code", () => {
  const page = readFileSync(join(repo, "docs/user/src/vibelang-features/imported-lint-diagnostics.md"), "utf8")
  expect(undocumentedCodes(rules.map(rule => rule.code), [page])).toEqual([])
  for (const rule of rules) expect(page).toContain("`effecttsgo/" + rule.rule + "`")
})

// Chapter 007: each imported rule has its own stable printed identity.
// Random document removal must be found by the ordinary coverage check.
test("the ordinary docs check catches omitted imported registrations, including five-digit codes", () => {
  fc.assert(fc.property(fc.subarray(rules, { minLength: 1, maxLength: 5 }), selected => {
    const root = mkdtempSync(join(tmpdir(), "imported-doc-coverage-"))
    try {
      for (const dir of ["typescript/tsc/internal/vibelang", "typescript/tsc/internal/vibelangmapper", "typescript/tsc/internal/core", "docs/user/src"])
        mkdirSync(join(root, dir), { recursive: true })
      writeFileSync(join(root, "typescript/tsc/internal/vibelang/diagnostics.go"), 'var EK9001 = message(9001, errorCategory, "projection")')
      writeFileSync(join(root, "typescript/tsc/internal/vibelangmapper/diagnostics.go"), "var projection = Diagnostic{Code: 9001}")
      writeFileSync(join(root, "typescript/tsc/internal/core/vibe_lint_codes.go"), "var VibeImportedLintCodes = map[string]string{\n" + selected.map(rule => JSON.stringify(rule.code) + ": " + JSON.stringify(rule.rule) + ",").join("\n") + "\n}")
      writeFileSync(join(root, "docs/user/src/reference.md"), "EK9001\n" + selected.map(rule => rule.code + "999999").join("\n"))
      writeFileSync(join(root, "docs/user/src/release-notes.md"), selected.map(rule => rule.code).join("\n"))
      expect(checkDiagnosticDocs(root)).toEqual(selected.map(rule => rule.code).sort())
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { seed: 3813038100, numRuns: 60 })
})


test("the generated reference retains every message variant and fails on an unrecognized rule", async () => {
  const { importedLintReference, renderImportedLintReference } = await import("./generate-imported-lint-reference.mjs")
  const actual = readFileSync(join(repo, "docs/user/src/vibelang-features/imported-lint-diagnostics.md"), "utf8")
  expect(actual).toBe(importedLintReference())
  fc.assert(fc.property(fc.integer({ min: 1, max: 6 }), fc.array(fc.stringMatching(/^[a-zA-Z]{1,20}$/), { minLength: 1, maxLength: 4 }), (ordinal, messages) => {
    const inventory = { upstream: { tag: "test", commit: "abc", repository: "https://example.test" }, rules: [
      { code: "EK38" + String(ordinal).padStart(2, "0"), rule: "fixture", source: "internal/rules/fixture.go", defaultSeverity: "warning" }
    ] }
    const templates = Object.fromEntries(messages.map(message => [message + " effect(fixture)", {}]))
    const page = renderImportedLintReference(inventory, templates)
    for (const message of messages) expect(page).toContain(message)
    expect(() => renderImportedLintReference(inventory, {})).toThrow(/no upstream diagnostic message/)
  }), { seed: 14638130, numRuns: 60 })
})


test("every reserved or emitted identity has guidance outside release history", async () => {
  const { loadIdentity } = await import("./diagnostic-identity.mjs")
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = join(dir, entry.name)
    return entry.isDirectory() ? walk(file) : file.endsWith(".md") && entry.name !== "release-notes.md" ? [readFileSync(file, "utf8")] : []
  })
  const pages = walk(join(repo, "docs/user/src"))
  const registered = [...loadIdentity(repo).registered.keys()]
  const documented = new Set(pages.flatMap(page => [...page.matchAll(/\bEK[0-9]+\b/g)].map(match => match[0])))
  expect(registered.length).toBeGreaterThan(0)
  expect(registered.filter(code => !documented.has(code))).toEqual([])
})
