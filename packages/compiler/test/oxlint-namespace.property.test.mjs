import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import fc from "fast-check"
import { namespaceFixture } from "./oxlint-namespace-fixture.mjs"

const corpus = JSON.parse(readFileSync(new URL("./property-regressions/alchemy-namespace-project-reference.json", import.meta.url), "utf8"))
const chapter = readFileSync(new URL("../../../docs/design/src/001-functions.md", import.meta.url), "utf8")
const quote = "TypeScript's `allowArbitraryExtensions` resolves it, so plain `tsc` and TypeDoc understand imports of `.vibe` files."

function inspect(input) {
  assert.ok(chapter.includes(quote), "the Chapter 1 sidecar resolution contract")
  const root = mkdtempSync(join(tmpdir(), "vibe-namespace-lint-"))
  try {
    for (const extension of ["ts", "vibe"]) for (const references of [false, true]) {
      const directory = join(root, extension + (references ? "-refs" : "-direct"))
      mkdirSync(directory)
      const { diagnostics } = namespaceFixture(directory, input, extension, references)
      const control = diagnostics.filter(d => d.span.line === 5)
      assert.equal(control.length, 1, "the type-aware negative control actually executes")
      assert.equal(control[0].code, "typescript(no-redundant-type-constituents)")
      assert.equal(control[0].message, "'any' overrides all other types in this union type.")
      const actual = diagnostics.filter(d => d.span.line !== 5)
      // Through a referenced VibeLang producer with
      // disableSourceOfProjectReferenceRedirect too: the native declaration
      // x.d.ts beside x.vibe re-exports its sidecar, so the namespace keeps
      // the declared type (VIP-27).
      assert.deepEqual(actual, [], "namespace and subpath retain the native declared interface type")
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("alchemy-57: namespace/project-reference witness with real type-aware Oxlint controls", () => inspect(corpus))
test("namespace typing across names, nesting and native/project-reference controls", () => {
  fc.assert(fc.property(fc.record({
    namespace: fc.constantFrom("RDS", "Storage", "Compute"),
    name: fc.constantFrom("DBInstance", "Bucket", "Cluster"),
    depth: fc.integer({ min: 1, max: 3 })
  }), inspect), { seed: 571101, numRuns: 12 })
})
