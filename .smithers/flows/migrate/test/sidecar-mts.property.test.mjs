import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { test } from "node:test"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const { rewriteExports, restoreExports } = await import(process.env.SIDECAR_CODEMOD_UNDER_TEST || new URL("../lib/codemod.mjs", import.meta.url))

test("property: relocated package exports round-trip native ts and mts filenames", () => {
  // VIP-27: "A package build also writes ordinary .d.ts files to its output directory."
  // Detail268 changes the compatibility path; the native source suffix still survives revert.
  const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-sidecar-mts-exports.json", import.meta.url), "utf8"))
  fc.assert(fc.property(fc.record({
    directory: fc.constantFrom(".vibe/declarations", "types", "gen/decl", ""),
    nested: fc.constantFrom("src", "src/deep"),
    extension: fc.constantFrom(".ts", ".mts"),
    bareEntries: fc.boolean()
  }), ({ directory, nested, extension, bareEntries }) => {
    const root = mkdtempSync(join(tmpdir(), "sidecar-mts-exports-"))
    try {
      mkdirSync(join(root, "node_modules"), { recursive: true })
      symlinkSync(dirname(require.resolve("typescript/package.json")), join(root, "node_modules/typescript"))
      mkdirSync(join(root, nested), { recursive: true })
      writeFileSync(join(root, nested, "x.vibe"), "export const value = 1\n")
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ vibe: { sidecarDir: directory } }))
      const source = "./" + nested + "/x" + extension
      const before = { name: "foldkit-mts-fixture", type: "module", types: source, exports: { ".": { types: source, import: source }, "./x": source } }
      writeFileSync(join(root, "package.json"), JSON.stringify(before))
      const edits = rewriteExports(root, [{ from: nested + "/x" + extension, to: nested + "/x.vibe" }], { bareEntries })
      const after = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
      const selected = "./" + posix.join(directory, nested, "x.d.vibe.ts")
      assert.equal(after.types, selected)
      const sourceTarget = "./" + nested + "/x.vibe"
      const runtime = { "vibelang-source": sourceTarget, default: "./.vibelang/js/" + nested + "/x.js" }
      assert.deepEqual(after.exports["."], { types: selected, import: bareEntries ? sourceTarget : runtime })
      assert.deepEqual(after.exports["./x"], bareEntries ? sourceTarget : { types: selected, ...runtime })
      restoreExports(root, edits, nested + "/x" + extension)
      assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")), before)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { examples: [[corpus.input], [{ directory: "types", nested: "src", extension: ".mts", bareEntries: true }]], seed: 26845136, numRuns: 80 })
})
