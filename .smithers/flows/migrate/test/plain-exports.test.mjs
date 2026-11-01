import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { bareVibeExports, renameBatch, restoreExports, rewriteExports } from "../lib/codemod.mjs"

const put = (root, path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}
const manifestsOf = (files) => Object.keys(files).filter((file) => file.endsWith("package.json"))

// Smithers: its contracts read "./src/X.vibe"; the codemod wrote
// { types, default } for 100 entries in 24 manifests.
test("smithers: a repository that exports its .vibe modules by bare paths gets its renamed modules' entries that way", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-plain-vibe-exports.json", import.meta.url), "utf8"))
  const root = mkdtempSync(join(tmpdir(), "migrate-exports-"))
  try {
    for (const [path, text] of Object.entries(corpus.files)) put(root, path, text)
    const bareEntries = bareVibeExports(root, manifestsOf(corpus.files))
    assert.equal(bareEntries, true)
    const renames = renameBatch(root, corpus.batch)
    const edits = rewriteExports(root, renames, { bareEntries })
    const manifest = () => JSON.parse(readFileSync(join(root, "packages/kernel/package.json"), "utf8"))
    assert.deepEqual(manifest().exports, corpus.expected)
    // revert puts each module's entries back as they were.
    for (const module of corpus.batch) restoreExports(root, edits, module)
    assert.deepEqual(manifest().exports, JSON.parse(corpus.files["packages/kernel/package.json"]).exports)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a repository without bare .vibe exports names the sidecar, source and emitted default", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-exports-"))
  try {
    const files = {
      "packages/core/package.json": '{ "name": "core", "exports": { "./model": "./src/model.ts", "./old": { "types": "./src/old.d.vibe.ts", "default": "./src/old.vibe" } } }\n',
      "packages/core/src/model.ts": "export const model = 1\n"
    }
    for (const [path, text] of Object.entries(files)) put(root, path, text)
    assert.equal(bareVibeExports(root, manifestsOf(files)), false)
    rewriteExports(root, renameBatch(root, ["packages/core/src/model.ts"]), { bareEntries: false })
    assert.deepEqual(JSON.parse(readFileSync(join(root, "packages/core/package.json"), "utf8")).exports["./model"], { types: "./src/model.d.vibe.ts", "vibelang-source": "./src/model.vibe", default: "./.vibelang/js/src/model.js" })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("bareVibeExports reads exports and imports maps, a bare exports string, and skips manifests that do not parse", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-exports-"))
  try {
    const cases = {
      "a/package.json": ['{ "imports": { "#route": "./src/Route.vibe" } }', true],
      "b/package.json": ['{ "exports": "./src/index.vibe" }', true],
      "c/package.json": ['{ "exports": { ".": { "default": "./src/index.vibe" } } }', false],
      "d/package.json": ['{ "main": "./src/index.vibe" }', false],
      "e/package.json": ["{ not json", false]
    }
    for (const [file, [text, expected]] of Object.entries(cases)) {
      put(root, file, text)
      assert.equal(bareVibeExports(root, [file]), expected, file)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
