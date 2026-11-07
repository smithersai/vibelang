import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import fc from "fast-check"
import { extensionlessImport, missingRelativeInputs } from "../src/relative-imports.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const diagnostic = (file, specifier) => ({
  code: "TS2307", file,
  text: `Cannot find module '${specifier}' or its corresponding type declarations.`
})

test("missing relative imports watch every source creation that can resolve them", async () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-missing-imports-"))
  try {
    await checkProperty(fc, {
      name: "missing-relative-inputs",
      rule: "packages/unplugin/README.md: recompiles in watch mode; TypeScript relative source resolution",
      arbitrary: fc.record({
        name: fc.array(fc.constantFrom("a", "b", "é", "日", "-", "_", " "), { minLength: 1, maxLength: 12 }).map(chars => "module-" + chars.join("")),
        style: fc.constantFrom("explicit", "rewritten", "extensionless", "directory"),
        extension: fc.constantFrom(".vibe", ".ts", ".tsx")
      }),
      numRuns: 100,
      command: "node --test test/missing-imports.property.test.mjs",
      async check({ name, style, extension }) {
        const importer = join(root, "entry.vibe")
        const specifier = "./" + name + (style === "explicit" ? extension : style === "rewritten" ? ".js" : "")
        const target = style === "directory" ? join(root, name, "index" + extension) : join(root, name + extension)
        const inputs = missingRelativeInputs([diagnostic(importer, specifier)])
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, "export const value = 1\n")
        try {
          // Resolve after creation, independently of the missing-file watcher.
          const resolved = style === "explicit" || style === "rewritten" ? target : extensionlessImport(root, specifier)
          assert.equal(resolved, target)
          assert.ok(inputs.includes(resolved), `${specifier} must watch the source that now resolves it`)
        } finally {
          rmSync(style === "directory" ? join(root, name) : target, { recursive: true, force: true })
        }
      }
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("missing import watches use the importing file and ignore unrelated diagnostics", () => {
  const root = join(tmpdir(), "project")
  const importer = join(root, "nested", "entry.vibe")
  const error = diagnostic(importer, "../créé.vibe")
  assert.deepEqual(missingRelativeInputs([error, error]), [join(root, "créé.vibe")])
  assert.deepEqual(missingRelativeInputs([
    diagnostic(importer, "absent-package"),
    { ...error, code: "TS2322" },
    { ...error, file: undefined }
  ]), [])
  assert.ok(missingRelativeInputs([diagnostic(importer, "./view.vibex")]).includes(join(root, "nested/view.vibex")))
  assert.deepEqual(missingRelativeInputs([{
    file: importer, code: "TS6263",
    text: "Module './missing.vibe' was resolved to 'missing.d.vibe.ts', but '--allowArbitraryExtensions' is not set."
  }]), [join(root, "nested/missing.vibe")])
})
