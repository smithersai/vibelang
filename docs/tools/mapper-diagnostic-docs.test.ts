import { expect, test } from "bun:test"
import fc from "fast-check"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkDiagnosticDocs, undocumentedCodes } from "./check-diagnostic-docs"
import { compilerCodes } from "./diagnostic-identity.mjs"

const repo = join(import.meta.dir, "../..")

test("user guidance covers mapper option, dependency and executable projection failures", () => {
  const page = readFileSync(join(repo, "docs/user/src/vibelang-features/diagnostic-code-map.md"), "utf8")
  expect(undocumentedCodes(["EK9001", "EK9002", "EK9003", "EK9004", "EK9005", "EK9006"], [page])).toEqual([])
  expect(page).toContain("options")
  expect(page).toContain("native compiler")
  expect(page).toContain("pinned")
})

test("the ordinary docs check inspects mapper registrations", () => {
  const root = mkdtempSync(join(tmpdir(), "mapper-doc-coverage-"))
  try {
    for (const dir of ["typescript/tsc/internal/vibelang", "typescript/tsc/internal/vibelangmapper", "docs/user/src"])
      mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, "typescript/tsc/internal/vibelang/diagnostics.go"), 'var EK9001 = message(9001, errorCategory, "projection")')
    writeFileSync(join(root, "typescript/tsc/internal/vibelangmapper/options.go"), "var invalid = Diagnostic{Code: 9003}")
    writeFileSync(join(root, "docs/user/src/reference.md"), "Native projection: EK9001")
    expect(checkDiagnosticDocs(root)).toEqual(["EK9003"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  expect(checkDiagnosticDocs()).toEqual([])
})

// Appendix B assigns these failures to the mapper independently of native messages.
// Delete any subset of entries: the coverage oracle must report exactly those codes.
test("mapper coverage detects missing entries across declaration and forwarding forms", () => {
  fc.assert(fc.property(fc.subarray([9001, 9002, 9003, 9004, 9005, 9006]), codes => {
    const sources = [
      { path: "typescript/tsc/internal/vibelangmapper/fixture.go", text:
        "func diag(code int32) Diagnostic { return Diagnostic{Code: code} }\n" +
        codes.map((code, index) => index % 2 ? "var d" + code + " = diag(" + code + ")" :
          "var d" + code + " = Diagnostic{Code: " + code + "}").join("\n") }
    ]
    const registered = codes.length ? [...compilerCodes(sources).keys()].sort() : []
    const documented = codes.filter(code => code % 2).map(code => "EK" + code)
    expect(undocumentedCodes(registered, documented)).toEqual(codes.filter(code => !(code % 2)).map(code => "EK" + code).sort())
  }), { seed: 90039004, numRuns: 100 })
})
