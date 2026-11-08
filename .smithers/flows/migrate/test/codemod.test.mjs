import assert from "node:assert/strict"
import { fakeProjectFiles } from "./helpers/fake-project-files.mjs"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { renameBatch, restoreExports, rewriteExports, rewriteImports, rewriteSpecifier, vibePath } from "../lib/codemod.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"

test("vibePath preserves source kinds and refuses declarations", () => {
  assert.equal(vibePath("src/a.ts"), "src/a.vibe")
  assert.throws(() => vibePath("src/a.d.ts"))
  assert.throws(() => vibePath("src/a.d.vibe.ts"))
  assert.equal(vibePath("src/a.tsx"), "src/a.vibex")
})

test("a .vibe importer names a renamed module by its source name and keeps every other written specifier", () => {
  assert.equal(rewriteSpecifier("src/a.vibe", "./b.js", "src/b.vibe"), "./b.vibe")
  assert.equal(rewriteSpecifier("src/a.vibe", "./dir", "src/dir/index.vibe"), "./dir/index.vibe")
  assert.equal(rewriteSpecifier("src/a.vibe", "./b.vibe", "src/b.vibe"), "./b.vibe")
  // A module that stays TypeScript keeps the specifier the repository wrote (detail 272):
  // foldkit's asyncData.vibe imports '../schema/index.js', and its declaration keeps it.
  assert.equal(rewriteSpecifier("src/a.vibe", "./c.js", "src/c.ts"), "./c.js")
  assert.equal(rewriteSpecifier("src/a.vibe", "../d/index.js", "d/index.ts"), "../d/index.js")
  assert.equal(rewriteSpecifier("src/a.vibe", "./e", "src/e.ts"), "./e")
  assert.equal(rewriteSpecifier("src/a.vibe", "./c.ts", "src/c.ts"), "./c.ts")
  // After revert returns b to .ts, the codemod's .vibe specifier names it again.
  assert.equal(rewriteSpecifier("src/a.vibe", "./b.vibe", "src/b.ts"), "./b.ts")
})

test("a .ts importer names a .vibe module by its source name, which stock TypeScript resolves to its sidecar", () => {
  assert.equal(rewriteSpecifier("src/a.ts", "./b.js", "src/b.vibe"), "./b.vibe")
  assert.equal(rewriteSpecifier("src/a.ts", "./b.ts", "src/b.vibe"), "./b.vibe")
  assert.equal(rewriteSpecifier("src/a.ts", "./b", "src/b.vibe"), "./b.vibe")
  assert.equal(rewriteSpecifier("src/a.ts", "./dir", "src/dir/index.vibe"), "./dir/index.vibe")
  assert.equal(rewriteSpecifier("src/a.ts", "./c.js", "src/c.ts"), "./c.js")
  // After revert returns b to .ts, the codemod's .vibe specifier names it again.
  assert.equal(rewriteSpecifier("src/a.ts", "./b.vibe", "src/b.ts"), "./b.ts")
})

// A package names its modules outside any importer: opencode's @opencode/util
// has `"./*": "./src/*.ts"`, which 234 imports in 20+ packages go through.
const withManifest = (manifest, files, check) => {
  const root = mkdtempSync(join(tmpdir(), "migrate-exports-"))
  try {
    mkdirSync(join(root, "packages/util/src/effect"), { recursive: true })
    writeFileSync(join(root, "package.json"), '{ "name": "root" }\n')
    writeFileSync(join(root, "packages/util/package.json"), JSON.stringify(manifest))
    for (const file of files) writeFileSync(join(root, file), "export const value = 1\n")
    check(root, () => JSON.parse(readFileSync(join(root, "packages/util/package.json"), "utf8")))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("a pattern that matches a renamed module gains an exact entry, and other modules keep the pattern", () => {
  const manifest = { name: "@o/util", exports: { "./effect/layer-node": "./src/effect/layer-node.ts", "./*": "./src/*.ts" } }
  withManifest(manifest, ["packages/util/src/bom.ts", "packages/util/src/effect/deep.ts", "packages/util/src/other.ts"], (root, read) => {
    const renames = renameBatch(root, ["packages/util/src/bom.ts", "packages/util/src/effect/deep.ts"])
    const edits = rewriteExports(root, renames)
    assert.deepEqual(read().exports, {
      "./effect/layer-node": "./src/effect/layer-node.ts",
      "./bom": { types: "./src/bom.d.vibe.ts", "vibelang-source": "./src/bom.vibe", default: "./.vibelang/js/src/bom.js" },
      "./effect/deep": { types: "./src/effect/deep.d.vibe.ts", "vibelang-source": "./src/effect/deep.vibe", default: "./.vibelang/js/src/effect/deep.js" },
      "./*": "./src/*.ts"
    })
    assert.deepEqual(Object.keys(read().exports).at(-1), "./*")
    assert.deepEqual(edits.map((e) => [e.manifest, e.field, e.key, e.added, e.module]), [
      ["packages/util/package.json", "exports", "./bom", true, "packages/util/src/bom.vibe"],
      ["packages/util/package.json", "exports", "./effect/deep", true, "packages/util/src/effect/deep.vibe"]
    ])
  })
})

test("an entry, a condition, an imports map and a main field that name a renamed module name its .vibe source", () => {
  const manifest = {
    main: "src/bom.ts",
    exports: { ".": { bun: "./src/bom.ts", default: "./dist/bom.js" }, "./other": "./src/other.ts" },
    imports: { "#bom": { workerd: "./src/bom.ts", default: "./src/other.ts" } }
  }
  withManifest(manifest, ["packages/util/src/bom.ts", "packages/util/src/other.ts"], (root, read) => {
    const edits = rewriteExports(root, renameBatch(root, ["packages/util/src/bom.ts"]))
    assert.deepEqual(read(), {
      main: "src/bom.vibe",
      exports: { ".": { bun: { "vibelang-source": "./src/bom.vibe", default: "./.vibelang/js/src/bom.js" }, default: "./dist/bom.js" }, "./other": "./src/other.ts" },
      imports: { "#bom": { workerd: { "vibelang-source": "./src/bom.vibe", default: "./.vibelang/js/src/bom.js" }, default: "./src/other.ts" } }
    })
    assert.equal(edits.length, 3)
  })
})

test("a conditional pattern gives its other conditions the module's own targets", () => {
  const manifest = { exports: { "./*.js": { types: "./dist/*.d.ts", bun: "./src/*.ts" } } }
  withManifest(manifest, ["packages/util/src/bom.ts"], (root, read) => {
    rewriteExports(root, renameBatch(root, ["packages/util/src/bom.ts"]))
    assert.deepEqual(read().exports["./bom.js"], { types: "./dist/bom.d.ts", bun: { "vibelang-source": "./src/bom.vibe", default: "./.vibelang/js/src/bom.js" } })
  })
})

// Stock TypeScript names a type a consumer infers from a module only through a
// target that is the module's declaration file: with ./model.vibe it reports
// TS2883 (drive-t3code), with ./model.d.vibe.ts it does not.
test("a types field or condition names the sidecar, and a bare entry gains one", () => {
  const manifest = {
    types: "./src/bom.ts",
    exports: { "./bom": { types: "./src/bom.ts", import: "./src/bom.ts" }, "./plain": "./src/bom.ts", "./other": "./src/other.ts" }
  }
  withManifest(manifest, ["packages/util/src/bom.ts", "packages/util/src/other.ts"], (root, read) => {
    const edits = rewriteExports(root, renameBatch(root, ["packages/util/src/bom.ts"]))
    assert.deepEqual(read(), {
      types: "./src/bom.d.vibe.ts",
      exports: {
        "./bom": { types: "./src/bom.d.vibe.ts", import: { "vibelang-source": "./src/bom.vibe", default: "./.vibelang/js/src/bom.js" } },
        "./plain": { types: "./src/bom.d.vibe.ts", "vibelang-source": "./src/bom.vibe", default: "./.vibelang/js/src/bom.js" },
        "./other": "./src/other.ts"
      }
    })
    restoreExports(root, edits, "packages/util/src/bom.ts")
    assert.deepEqual(read(), manifest)
  })
})

test("a package that names no renamed module is not rewritten", () => {
  const manifest = { exports: { "./*": "./lib/*.js" } }
  withManifest(manifest, ["packages/util/src/bom.ts"], (root, read) => {
    assert.deepEqual(rewriteExports(root, renameBatch(root, ["packages/util/src/bom.ts"])), [])
    assert.deepEqual(read(), manifest)
  })
})

test("restoreExports undoes one module's entries and keeps the others'", () => {
  const manifest = { main: "src/bom.ts", exports: { ".": "./src/other.ts", "./*": "./src/*.ts" } }
  withManifest(manifest, ["packages/util/src/bom.ts", "packages/util/src/other.ts"], (root, read) => {
    const edits = rewriteExports(root, renameBatch(root, ["packages/util/src/bom.ts", "packages/util/src/other.ts"]))
    const other = { types: "./src/other.d.vibe.ts", "vibelang-source": "./src/other.vibe", default: "./.vibelang/js/src/other.js" }
    assert.deepEqual(read(), { main: "src/bom.vibe", exports: { ".": other, "./bom": { types: "./src/bom.d.vibe.ts", "vibelang-source": "./src/bom.vibe", default: "./.vibelang/js/src/bom.js" }, "./other": other, "./*": "./src/*.ts" } })
    restoreExports(root, edits, "packages/util/src/bom.ts")
    assert.deepEqual(read(), { main: "src/bom.ts", exports: { ".": other, "./other": other, "./*": "./src/*.ts" } })
    restoreExports(root, edits, "packages/util/src/other.ts")
    assert.deepEqual(read(), { ...manifest, exports: { ".": "./src/other.ts", "./*": "./src/*.ts" } }, "both reverted, only the added entries are gone")
  })
})

// Bun matches a mock by the module it resolves, and an extensionless path does not
// reach a .vibe module through the preload, so the mock silently stops applying.
test("rewriteImports names a mocked .vibe module by its source name, and leaves others", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-mock-"))
  try {
    mkdirSync(join(root, "src"))
    mkdirSync(join(root, "test"))
    writeFileSync(join(root, "src/mini.vibe"), "export const mini = 1\n")
    writeFileSync(join(root, "src/other.ts"), "export const other = 1\n")
    writeFileSync(join(root, "test/a.test.ts"), [
      "import { mock } from \"bun:test\"",
      "mock.module(\"../src/mini\", () => ({ mini: 2 }))",
      "mock.module(\"../src/other\", () => ({ other: 2 }))",
      "mock.module(\"effect\", () => ({}))",
      ""
    ].join("\n"))
    const edits = rewriteImports(root, ["src/mini.vibe", "src/other.ts", "test/a.test.ts"])
    assert.deepEqual(edits, [{ file: "test/a.test.ts", from: "../src/mini", to: "../src/mini.vibe" }])
    const text = readFileSync(join(root, "test/a.test.ts"), "utf8")
    assert.ok(text.includes("mock.module(\"../src/mini.vibe\", () => ({ mini: 2 }))"))
    assert.ok(text.includes("mock.module(\"../src/other\", () => ({ other: 2 }))"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("renameBatch and rewriteImports update a small package", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-codemod-"))
  try {
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "src/a.ts"), "import { b } from './b.js'\nimport { c } from './c.js'\nexport const a = b + c\n")
    writeFileSync(join(root, "src/b.ts"), "export const b = 1\n")
    writeFileSync(join(root, "src/c.ts"), "import { a } from './a.js'\nexport const c = 2\n")
    writeFileSync(join(root, "src/d.vibe"), "import { a } from './a.ts'\n")
    const renames = renameBatch(root, ["src/a.ts"])
    assert.deepEqual(renames, [{ from: "src/a.ts", to: "src/a.vibe" }])
    assert.throws(() => renameBatch(root, ["src/a.ts"]), /does not exist/)
    const edits = rewriteImports(root, ["src/a.vibe", "src/b.ts", "src/c.ts", "src/d.vibe"])
    // The renamed module's importers name it by its source name; a.vibe's own
    // imports of modules that stay TypeScript keep their written spelling.
    assert.deepEqual(edits, [
      { file: "src/c.ts", from: "./a.js", to: "./a.vibe" },
      { file: "src/d.vibe", from: "./a.ts", to: "./a.vibe" }
    ])
    assert.equal(readFileSync(join(root, "src/a.vibe"), "utf8"), "import { b } from './b.js'\nimport { c } from './c.js'\nexport const a = b + c\n")
    assert.equal(readFileSync(join(root, "src/c.ts"), "utf8"), "import { a } from './a.vibe'\nexport const c = 2\n")
    assert.equal(existsSync(join(root, "src/a.ts")), false)
    assert.deepEqual(rewriteImports(root, ["src/a.vibe", "src/b.ts", "src/c.ts", "src/d.vibe"]), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("directory slash specifiers keep the selected index source", () => {
  assert.equal(rewriteSpecifier("pkg/a.vibe", "./runtime/", "pkg/runtime/index.vibe"), "./runtime/index.vibe")
  assert.equal(rewriteSpecifier("pkg/a.vibe", "./", "pkg/index.ts"), "./")
  assert.equal(rewriteSpecifier("pkg/a.vibe", "../", "index.vibe"), "../index.vibe")
  // A .ts importer names the migrated index by its source name too (opencode-19).
  assert.equal(rewriteSpecifier("pkg/a.ts", "./runtime/", "pkg/runtime/index.vibe"), "./runtime/index.vibe")
  assert.equal(rewriteSpecifier("pkg/a.ts", "./runtime/", "pkg/runtime/index.ts"), "./runtime/")
})

// Minimized opencode stats/core namespace re-export: every migrated module is
// reached through an extensionless TypeScript barrel.
test("opencode namespace re-exports name the migrated source for stock checkers", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-opencode-namespace-"))
  try {
    writeFileSync(join(root, "index.ts"), 'export * as Runtime from "./runtime"\nexport { other } from "./other"\n')
    writeFileSync(join(root, "runtime.vibe"), "export const value = 42\n")
    writeFileSync(join(root, "other.ts"), "export const other = 1\n")
    const edits = rewriteImports(root, ["index.ts", "runtime.vibe", "other.ts"])
    assert.deepEqual(edits, [{ file: "index.ts", from: "./runtime", to: "./runtime.vibe" }])
    assert.equal(readFileSync(join(root, "index.ts"), "utf8"), 'export * as Runtime from "./runtime.vibe"\nexport { other } from "./other"\n')
    assert.deepEqual(rewriteImports(root, ["index.ts", "runtime.vibe", "other.ts"]), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
