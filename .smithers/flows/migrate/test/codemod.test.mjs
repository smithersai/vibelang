import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { fixToFixedPoint, mergeFixes, parseFixOutput, renameBatch, restoreExports, rewriteExports, rewriteImports, rewriteSpecifier, rewriteTotals, vibePath } from "../lib/codemod.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"

test("vibePath renames only .ts modules", () => {
  assert.equal(vibePath("src/a.ts"), "src/a.vibe")
  assert.throws(() => vibePath("src/a.d.ts"))
  assert.throws(() => vibePath("src/a.d.vibe.ts"))
  assert.throws(() => vibePath("src/a.tsx"))
})

test("a .vibe importer names local modules by their source names", () => {
  assert.equal(rewriteSpecifier("src/a.vibe", "./b.js", "src/b.vibe"), "./b.vibe")
  assert.equal(rewriteSpecifier("src/a.vibe", "./c.js", "src/c.ts"), "./c.ts")
  assert.equal(rewriteSpecifier("src/a.vibe", "../d/index.js", "d/index.ts"), "../d/index.ts")
  assert.equal(rewriteSpecifier("src/a.vibe", "./e", "src/e.ts"), "./e.ts")
  assert.equal(rewriteSpecifier("src/a.vibe", "./dir", "src/dir/index.vibe"), "./dir/index.vibe")
  assert.equal(rewriteSpecifier("src/a.vibe", "./b.vibe", "src/b.vibe"), "./b.vibe")
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
    assert.deepEqual(edits, [
      { file: "src/a.vibe", from: "./b.js", to: "./b.ts" },
      { file: "src/a.vibe", from: "./c.js", to: "./c.ts" },
      { file: "src/c.ts", from: "./a.js", to: "./a.vibe" },
      { file: "src/d.vibe", from: "./a.ts", to: "./a.vibe" }
    ])
    assert.equal(readFileSync(join(root, "src/a.vibe"), "utf8"), "import { b } from './b.ts'\nimport { c } from './c.ts'\nexport const a = b + c\n")
    assert.equal(readFileSync(join(root, "src/c.ts"), "utf8"), "import { a } from './a.vibe'\nexport const c = 2\n")
    assert.equal(existsSync(join(root, "src/a.ts")), false)
    assert.deepEqual(rewriteImports(root, ["src/a.vibe", "src/b.ts", "src/c.ts", "src/d.vibe"]), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("parseFixOutput reads applied rewrites, refusals and the total", () => {
  const output = [
    "vibelang --fix: src/users.vibe: 4 fixes (EK4830 ×1, EK4831 ×1, EK4833 ×1, prelude import ×1)",
    "vibelang --fix: src/one.vibe: 1 fix (EK4834 ×1)",
    "vibelang --fix: src/users.vibe:12: EK4835 not fixed: the fixed program would report TS2322: Type 'unknown' is not assignable",
    "vibelang --fix: 5 fixes in 2 files; 1 fix refused.",
    "src/users.vibe(8,60): error EK1002: Effect.gen expects a JavaScript generator"
  ].join("\n")
  const parsed = parseFixOutput(output, { cwd: "/repo/packages/p", root: "/repo" })
  assert.equal(parsed.total, 5)
  assert.deepEqual(parsed.files, {
    "packages/p/src/users.vibe": { EK4830: 1, EK4831: 1, EK4833: 1, "prelude import": 1 },
    "packages/p/src/one.vibe": { EK4834: 1 }
  })
  assert.deepEqual(parsed.refused, [{ file: "packages/p/src/users.vibe", line: 12, code: "EK4835", error: "TS2322: Type 'unknown' is not assignable" }])
  assert.deepEqual(parseFixOutput("vibelang --fix: 0 fixes in 0 files.\n"), { total: 0, files: {}, refused: [] })
})

test("mergeFixes and rewriteTotals add rounds and files", () => {
  const merged = mergeFixes(mergeFixes({}, { a: { EK4830: 1 } }), { a: { EK4830: 2, "prelude import": 1 }, b: { EK4833: 1 } })
  assert.deepEqual(merged, { a: { EK4830: 3, "prelude import": 1 }, b: { EK4833: 1 } })
  assert.deepEqual(rewriteTotals(merged), { EK4830: 3, "prelude import": 1, EK4833: 1 })
})

test("fixToFixedPoint keeps the rewrites of the batch's files only, and an earlier batch's file stays as committed", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-fix-scope-"))
  try {
    mkdirSync(join(root, "pkg/src"), { recursive: true })
    writeFileSync(join(root, "pkg/src/batch.vibe"), "export const a = 1\n")
    writeFileSync(join(root, "pkg/src/earlier.vibe"), "import * as DateTime from \"effect/DateTime\"\n")
    // A compiler whose --fix rewrites every .vibe file of the project it has not rewritten yet, as vibelang does.
    const compiler = join(root, "fake-vibelang")
    writeFileSync(compiler, `#!/usr/bin/env node
const fs = require("node:fs")
let n = 0
for (const file of ["src/batch.vibe", "src/earlier.vibe"]) {
  const text = fs.readFileSync(file, "utf8")
  if (text.includes("// fixed")) continue
  fs.writeFileSync(file, text + "// fixed\\n")
  console.log("vibelang --fix: " + file + ": 1 fix (prelude import ×1)")
  n++
}
console.log("vibelang --fix: " + n + " fixes in " + n + " files.")
`)
    chmodSync(compiler, 0o755)
    const result = await fixToFixedPoint({ compiler, tsconfig: "tsconfig.json", cwd: join(root, "pkg"), root, only: ["pkg/src/batch.vibe"] })
    assert.equal(readFileSync(join(root, "pkg/src/earlier.vibe"), "utf8"), "import * as DateTime from \"effect/DateTime\"\n")
    assert.equal(readFileSync(join(root, "pkg/src/batch.vibe"), "utf8"), "export const a = 1\n// fixed\n")
    assert.deepEqual(Object.keys(result.byFile), ["pkg/src/batch.vibe"])
    assert.equal(result.settled, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// drive-t3code-server 19:16Z: the 534-file server batch imports 184 modules
// migrated earlier in other packages; --fix in apps/server rewrote
// ../lib/error.vibe (EK4837), and the flow reported no fix and kept it.
test("fixToFixedPoint puts back an earlier batch's file in another package that --fix rewrote", async () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-fix-scope-outside-package.json", import.meta.url), "utf8"))
  const root = mkdtempSync(join(tmpdir(), "migrate-fix-scope-outside-"))
  try {
    for (const [file, text] of Object.entries(corpus.files)) {
      mkdirSync(join(root, file, ".."), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    // vibelang --fix rewrites the project's every .vibe file, the dependency outside cwd included.
    const compiler = join(root, "fake-vibelang")
    writeFileSync(compiler, `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path")
let n = 0
for (const [file, text] of Object.entries(${JSON.stringify(corpus.fixed)})) {
  const abs = path.join(${JSON.stringify(root)}, file)
  if (fs.readFileSync(abs, "utf8") === text) continue
  fs.writeFileSync(abs, text)
  console.log("vibelang --fix: " + path.relative(process.cwd(), abs) + ": 1 fix (EK4837 ×1)")
  n++
}
console.log("vibelang --fix: " + n + " fixes in " + n + " files.")
`)
    chmodSync(compiler, 0o755)
    const result = await fixToFixedPoint({ compiler, tsconfig: "tsconfig.json", cwd: join(root, "pkg"), root, only: corpus.batch })
    for (const [file, text] of Object.entries(corpus.files)) assert.equal(readFileSync(join(root, file), "utf8"), text, `${corpus.key}: ${file}`)
    assert.deepEqual(result.byFile, {})
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("the fix loop asks for declarations, so --fix keeps what they print under a noEmit tsconfig", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-fix-"))
  try {
    const seen = join(root, "args.txt")
    const compiler = join(root, "vibelang")
    writeFileSync(compiler, `#!/bin/sh\necho "$@" > ${seen}\necho 'vibelang --fix: 0 fixes in 0 files.'\n`, { mode: 0o755 })
    await fixToFixedPoint({ compiler, tsconfig: "tsconfig.json", cwd: root, root })
    assert.match(readFileSync(seen, "utf8"), /--fix --noEmit --declaration/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("directory slash specifiers keep the selected index source", () => {
  assert.equal(rewriteSpecifier("pkg/a.vibe", "./runtime/", "pkg/runtime/index.vibe"), "./runtime/index.vibe")
  assert.equal(rewriteSpecifier("pkg/a.vibe", "./", "pkg/index.ts"), "./index.ts")
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
