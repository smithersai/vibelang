// VIP-40 tooling and diagnostic-allocation rules (docs/design/vips/0040-module-declarations.md).
// Will, 2026-11-03: each unimplemented spec rule must at least have a test.todo.
import { expect, test } from "bun:test"
import fc from "fast-check"
import { compilerCodes } from "./diagnostic-identity.mjs"
import { readFileSync } from "node:fs"

const root = new URL("../../", import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), "utf8")

test("VIP-40 owns the EK40xx block: EK4001 through EK4009 are registered errors", () => {
  // VIP-40: VIP-34 gives VIP-40 the EK40xx block — spec-rule: docs/design/vips/0040-module-declarations.md#3eb952529ce418aa
  const registry = read("typescript/tsc/internal/core/vibe_diagnostic_registry.go")
  assertModuleRegistry(registry)
})

function assertModuleRegistry(source: string) {
  const registry = compilerCodes([{ path: "typescript/tsc/internal/core/vibe_diagnostic_registry.go", text: source }])
  const block = [...registry.keys()].filter(code => /^EK40\d\d$/.test(code)).sort()
  expect(block).toEqual(Array.from({ length: 9 }, (_, n) => "EK" + (4001 + n)))
  for (const code of block) expect(registry.get(code).every(site => site.category === "error")).toBe(true)
}

test("VIP-40 registration survives Go formatting but rejects missing or weakened codes", () => {
  fc.assert(fc.property(fc.constantFrom(" ", "  ", "\t", "\n"), fc.integer({ min: 4001, max: 4009 }), (space, code) => {
    const entries = Array.from({ length: 9 }, (_, n) => '"EK' + (4001 + n) + '":' + space + '"error",')
    const source = "var VibeDiagnosticCategories = map[string]string{" + space + entries.join(space) + "}"
    assertModuleRegistry(source)
    expect(() => assertModuleRegistry(source.replace('"EK' + code + '":' + space + '"error",', ""))).toThrow()
    expect(() => assertModuleRegistry(source.replace('"EK' + code + '":' + space + '"error",',
      '"EK' + code + '":' + space + '"warning",'))).toThrow()
  }), { seed: 404009, numRuns: 90 })
})

// VIP-40: old EK4407 and EK4408 are retired — spec-rule: docs/design/vips/0040-module-declarations.md#cd916c5d93ca1d81
test("VIP-40: old EK4407 and EK4408 are retired: no diagnostic table registers or reports them (spec-rule: docs/design/vips/0040-module-declarations.md#cd916c5d93ca1d81)", () => {
  const native = read("typescript/tsc/internal/vibelang/diagnostics.go")
  const registry = read("typescript/tsc/internal/core/vibe_diagnostic_registry.go")
  expect(native).not.toMatch(/message\(440[78],/)
  expect(registry).not.toMatch(/"EK440[78]"/)
})

// VIP-40: Oxlint's JS-plugin rules apply to a body where they apply to .ts — spec-rule: docs/design/vips/0040-module-declarations.md#9b3e85fb97fd15b0
test.todo("VIP-40: Oxlint's JS-plugin rules report inside a module body exactly where they report in the sibling .ts file (spec-rule: docs/design/vips/0040-module-declarations.md#9b3e85fb97fd15b0)")

// VIP-40: TypeScript mapper projects each body as its own virtual .ts file — spec-rule: docs/design/vips/0040-module-declarations.md#df7751c514dcf8d7
// Pending: packages/ts-mapper/test/property-regressions/inline-refusal.json still requires the EK9005 refusal.
test.todo("VIP-40: TypeScript mapper projects each module body as its own virtual .ts file instead of refusing with EK9100 (spec-rule: docs/design/vips/0040-module-declarations.md#df7751c514dcf8d7)")

// VIP-40: Move module to a TypeScript file is offered in the editor, never run by --fix — spec-rule: docs/design/vips/0040-module-declarations.md#ae6a91e8e2b38253
test.todo("VIP-40: the Move module to a TypeScript file refactor is offered in the editor and never run by vibelang --fix (spec-rule: docs/design/vips/0040-module-declarations.md#ae6a91e8e2b38253)")
