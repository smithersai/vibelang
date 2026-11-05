import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { listSources, resolveSource } from "vibelang/source"

const corpus = JSON.parse(readFileSync(new URL("./property-regressions/alchemy-intro-snippets.json", import.meta.url), "utf8"))

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-source-files-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test("source tools enumerate migrated snippets and resolve literal deck paths", (t) => {
  const root = fixture(t)
  for (const [file, text] of Object.entries(corpus.files)) {
    mkdirSync(join(root, file, ".."), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  assert.deepEqual(listSources(root).map(file => relative(root, file)), corpus.sources)
  for (const [requested, actual] of Object.entries(corpus.references)) {
    const resolved = resolveSource(join(root, requested))
    assert.equal(resolved, join(root, actual))
    assert.equal(readFileSync(resolved, "utf8"), corpus.files[actual])
  }
})

test("exact files win; declarations, missing files and directories never become native fallbacks", (t) => {
  const root = fixture(t)
  for (const file of ["both.ts", "both.vibe", "only.vibe", "types.d.vibe", "types.d.vibe.ts", "plain.tsx", "view.vibex"])
    writeFileSync(join(root, file), file)
  mkdirSync(join(root, "directory.ts"))
  writeFileSync(join(root, "directory.vibe"), "")
  assert.equal(resolveSource(join(root, "both.ts")), join(root, "both.ts"))
  assert.equal(resolveSource(join(root, "only.ts")), join(root, "only.vibe"))
  assert.equal(resolveSource(join(root, "view.tsx")), join(root, "view.vibex"))
  for (const file of ["types.d.ts", "view.ts", "missing.ts", "plain.vibex", "directory.ts"])
    assert.equal(resolveSource(join(root, file)), undefined, file)
  assert.equal(resolveSource(join(root, "types.d.vibe.ts")), join(root, "types.d.vibe.ts"))
  assert.equal(resolveSource(join(root, "only.vibe", "child.ts")), undefined)
})

test("discovery excludes declarations and generated files, follows file symlinks and stays in one directory", (t) => {
  const root = fixture(t)
  for (const file of ["plain.ts", "view.tsx", "native.vibe", "native-view.vibex", "ordinary.d.ts",
    "native.d.vibe.ts", "native-view.d.vibex.ts", "native.vibe.helper.d.ts", "out.js", "README.md"])
    writeFileSync(join(root, file), "")
  mkdirSync(join(root, "folder.vibe"))
  writeFileSync(join(root, "folder.vibe", "nested.ts"), "")
  symlinkSync("plain.ts", join(root, "linked.ts"))
  symlinkSync("absent.ts", join(root, "broken.ts"))
  assert.deepEqual(listSources(root).map(file => relative(root, file)),
    ["linked.ts", "native-view.vibex", "native.vibe", "plain.ts", "view.tsx"])
})

test("property: migration changes source names without losing source reads or expected-error identities", () => {
  const stem = fc.array(fc.constantFrom("a", "b", "0", "-", " ", "#", "%", "λ"), { minLength: 1, maxLength: 12 })
    .map(parts => "snippet-" + parts.join(""))
  fc.assert(fc.property(stem, fc.boolean(), fc.boolean(), (name, jsx, negative) => {
    const root = mkdtempSync(join(tmpdir(), "vibelang-source-property-"))
    try {
      const prefix = name + (negative ? ".error" : "")
      const original = prefix + (jsx ? ".tsx" : ".ts")
      const native = prefix + (jsx ? ".vibex" : ".vibe")
      const text = negative ? 'export const value: number = "wrong"\n' : "export const value = 1\n"
      writeFileSync(join(root, native), text)
      writeFileSync(join(root, prefix + (jsx ? ".d.vibex.ts" : ".d.vibe.ts")), "export declare const value: number")
      assert.deepEqual(listSources(root), [join(root, native)])
      assert.equal(readFileSync(resolveSource(join(root, original)), "utf8"), text)
      assert.equal(/\.error\.(?:tsx?|vibex?)$/.test(resolveSource(join(root, original))), negative)
      writeFileSync(join(root, original), "original")
      assert.equal(readFileSync(resolveSource(join(root, original)), "utf8"), "original")
      rmSync(join(root, original))
      rmSync(join(root, native))
      assert.equal(resolveSource(join(root, original)), undefined)
      assert.deepEqual(listSources(root), [])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { numRuns: 100, seed: 34095 })
})
