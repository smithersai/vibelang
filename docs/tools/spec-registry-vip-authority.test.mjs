import assert from "node:assert/strict"
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import fc from "fast-check"
import { diagnosticRegistry, lintRegistry, read, repository } from "./spec-rules.mjs"

const appendix = "docs/design/src/900-appendices.md"
const vip5 = "docs/design/vips/0005-try-runs-effects.md"
const owners = [["EK0401", 7], ["EK0406", 27]]
const authorityErrors = root => lintRegistry(root).filter(f =>
  f.severity === "error" && /VIP-(5|7|27) cites EK(0401|0406|0511)\b/.test(f.message))

test("accepted VIP-5, VIP-7 and VIP-27 diagnostic citations have current registry authority", () => {
  // Appendix B: "Diagnostic ownership follows the source rule, not the parser helper".
  assert.ok(read(repository, appendix).includes("Diagnostic ownership follows the source rule, not the parser helper"))
  assert.deepEqual(authorityErrors(repository), [])
  // Appendix B: "The old `EK0511` is retired too".
  assert.ok(read(repository, appendix).includes("The old `EK0511` is retired too"))
  assert.equal(diagnosticRegistry(repository).has("EK0511"), false)
})

test("fast-check: omitting a cited VIP or the historical marker exposes the exact registry error", () => {
  mkdirSync(join(repository, ".cache"), { recursive: true })
  const root = mkdtempSync(join(repository, ".cache/spec-registry-vips-"))
  try {
    for (const dir of ["src", "vips"]) {
      mkdirSync(join(root, "docs/design"), { recursive: true })
      cpSync(join(repository, "docs/design", dir), join(root, "docs/design", dir), { recursive: true })
    }
    for (const file of ["typescript/tsc/internal/diagnostics/diagnosticMessages.json",
      "typescript/tsc/internal/tsoptions/declarations_generated.go"]) {
      mkdirSync(join(root, file, ".."), { recursive: true })
      writeFileSync(join(root, file), read(repository, file))
    }
    const original = read(root, appendix), historical = read(root, vip5)
    fc.assert(fc.property(fc.constantFrom(...owners), fc.boolean(), ([code, vip], old) => {
      const mutant = original.split("\n").map(line => {
        if (!line.startsWith("| `" + code + "`")) return line
        const cells = line.split(" | ")
        const ids = cells[2].split(",").map(x => x.trim())
        assert.ok(ids.includes(String(vip)))
        cells[2] = ids.filter(id => id !== String(vip)).join(", ")
        return cells.join(" | ")
      }).join("\n")
      writeFileSync(join(root, appendix), mutant)
      writeFileSync(join(root, vip5), old ? historical : historical.replace("the old `EK0511` is retired", "`EK0511` is retired"))
      const errors = authorityErrors(root)
      assert.ok(errors.some(f => f.message === "VIP-" + vip + " cites " + code + " but its registry authority does not name VIP-" + vip))
      assert.equal(errors.some(f => f.message.includes("VIP-5 cites EK0511")), !old)
    }), { seed: 50427, numRuns: 24 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
