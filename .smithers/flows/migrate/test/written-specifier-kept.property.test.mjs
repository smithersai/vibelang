import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { renameBatch, rewriteImports, rewriteSpecifier } from "../lib/codemod.mjs"

// Decided detail 272: only a module-specifier literal naming a mechanically
// renamed module may gain its new extension. A .vibe importer's written
// specifier of a module that stays TypeScript (./c.js, ../d/index.js, ./e) is
// resolved by VibeLang as TypeScript resolves it, and its declaration keeps the
// written spelling, so the published .d.ts matches the original byte for byte.
// Witness: foldkit's asyncData.vibe wrote '../schema/index.js' (18 of its 225
// declarations differed only because the codemod spelled it '../schema/index.ts').

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const fc = createRequire(join(runtime, "package.json"))("fast-check")

const name = fc.constantFrom("a", "b", "schema", "index", "slowPhase", "resourceProvider")
const dir = fc.constantFrom("", "lib/", "../", "../schema/", "./nested/")
const writtenExt = fc.constantFrom(".js", ".ts", ".mjs", ".mts", "")
const importerKind = fc.constantFrom(".vibe", ".ts")
const targetKind = fc.constantFrom(".vibe", ".ts")

test("a written specifier changes only when it names a renamed module or was spelled .vibe for a reverted one", () => {
  fc.assert(fc.property(importerKind, targetKind, dir, name, writtenExt, (ik, tk, d, n, ext) => {
    const importer = `src/use${ik}`
    const specifier = `./${d}${n}${ext}`
    const target = posix.normalize(posix.join("src", `${d}${n}${tk}`))
    const next = rewriteSpecifier(importer, specifier, target)
    if (tk === ".vibe") {
      // The renamed module is named by its source name, by every importer.
      assert.equal(next, `./${d}${n}.vibe`)
    } else {
      // A module that stays TypeScript keeps the written specifier.
      assert.equal(next, specifier)
    }
  }), { numRuns: 400 })
})

test("a .vibe importer's .vibe spelling of a reverted module goes back to the file's extension", () => {
  fc.assert(fc.property(importerKind, dir, name, fc.constantFrom(".ts", ".mts", ".tsx"), (ik, d, n, back) => {
    const next = rewriteSpecifier(`src/use${ik}`, `./${d}${n}.vibe`, posix.normalize(posix.join("src", `${d}${n}${back}`)))
    assert.equal(next, `./${d}${n}${back}`)
  }), { numRuns: 200 })
})

test("foldkit: a migrated module's import of a module that stays TypeScript is left as the repository wrote it", () => {
  // Corpus foldkit-asyncData-schema-index: src/asyncData/asyncData.ts imports
  // '../schema/index.js' (unchanged schema/index.ts) and src/asyncData/index.ts
  // re-exports './asyncData.js'; the batch renames asyncData.ts only.
  fc.assert(fc.property(fc.constantFrom("'", '"'), fc.constantFrom("./x.js", "./x.ts", "./x"), (q, sibling) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-written-specifier-"))
    try {
      mkdirSync(join(root, "src/asyncData"), { recursive: true })
      mkdirSync(join(root, "src/schema"), { recursive: true })
      writeFileSync(join(root, "src/schema/index.ts"), "export const taggedStruct = 1\n")
      writeFileSync(join(root, "src/asyncData/x.ts"), "export const x = 1\n")
      writeFileSync(join(root, "src/asyncData/asyncData.ts"), `import { taggedStruct } from ${q}../schema/index.js${q}\nimport { x } from ${q}${sibling}${q}\nexport const a = taggedStruct + x\n`)
      writeFileSync(join(root, "src/asyncData/index.ts"), `export * from ${q}./asyncData.js${q}\n`)
      renameBatch(root, ["src/asyncData/asyncData.ts"])
      const scope = ["src/asyncData/asyncData.vibe", "src/asyncData/index.ts", "src/asyncData/x.ts", "src/schema/index.ts"]
      const edits = rewriteImports(root, scope, ["src/asyncData/asyncData.vibe"])
      assert.deepEqual(edits, [{ file: "src/asyncData/index.ts", from: "./asyncData.js", to: "./asyncData.vibe" }])
      assert.equal(readFileSync(join(root, "src/asyncData/asyncData.vibe"), "utf8"), `import { taggedStruct } from ${q}../schema/index.js${q}\nimport { x } from ${q}${sibling}${q}\nexport const a = taggedStruct + x\n`)
      assert.equal(readFileSync(join(root, "src/asyncData/index.ts"), "utf8"), `export * from ${q}./asyncData.vibe${q}\n`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { numRuns: 12 })
})
