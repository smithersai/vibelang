import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import ts from "typescript"
import { checkProperty } from "../../scripts/testing/property.mjs"
import { block, read, tools } from "./spec-witness.mjs"

const example = () => block(read("docs/design/vips/0073-std-patterns.md"), "// proposed: PACKAGE.vibe", "ts")

const diagnostics = (source) => {
  const directory = mkdtempSync(join(tools, ".spec-package-vibe-"))
  try {
    const files = (Array.isArray(source) ? source : [source]).map((text, index) => {
      const file = join(directory, `PACKAGE${index}.ts`)
      writeFileSync(file, text)
      return file
    })
    const program = ts.createProgram(files, {
      strict: true, noEmit: true, skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext
    })
    return ts.getPreEmitDiagnostics(program)
      .filter(d => d.category === ts.DiagnosticCategory.Error)
      .map(d => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test("VIP-73's PACKAGE.vibe example type-checks against the build target API", () => {
  assert.deepEqual(diagnostics(example()), [])
})

test("the example checker rejects a root import of Package and Vitest's unsupported srcs option", () => {
  const source = example()
  assert.ok(diagnostics(source.replace('from "@smthrs/targets/Package"', 'from "@smthrs/targets"')).length > 0)
  assert.ok(diagnostics(source.replaceAll("Filegroup", "Vitest")).length > 0)
})

// VIP-73: "It is an ordinary VibeLang module" that "exports the same values".
// Check generated declarations against the real target types, including the
// source glob's string and array overloads. No SDK or build actions execute.
test("property: the printed build declaration accepts generated source globs", async () => {
  const source = example()
  assert.ok(source.includes('glob("src/**/*.vibe")'))
  const pattern = fc.stringMatching(/^[a-z]{1,12}$/).map(name => `${name}/**/*.vibe`)
  await checkProperty(fc, {
    name: "spec-package-vibe-declaration-globs",
    rule: "VIP-73: PACKAGE.vibe is an ordinary module that exports the same build-declaration values as PACKAGE.ts",
    command: "bun test --timeout 60000 spec-package-vibe.test.mjs",
    arbitrary: fc.noShrink(fc.array(pattern, { minLength: 10, maxLength: 10 })),
    numRuns: 5,
    check: globs => {
      const sources = globs.flatMap(glob => [
        source.replaceAll("src/**/*.vibe", glob),
        source.replace('[glob("src/**/*.vibe")]', `glob(${JSON.stringify([glob])})`)
      ])
      assert.deepEqual(diagnostics(sources), [])
    }
  })
})
