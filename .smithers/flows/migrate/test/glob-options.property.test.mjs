import assert from "node:assert/strict"
import { globSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { rewriteSourceLiterals, checkSelectorEdits, restoreSourceLiterals } from "../lib/source-paths.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-docpage-glob-options.json", import.meta.url)))

test("foldkit selector options: an exclude pattern cannot become a source include proof", () => {
  const moved = [{ from: "page/main.ts", to: "page/main.vibe" }]
  const result = rewriteSourceLiterals(ts, corpus.text, "collector.ts", moved, { inventory: corpus.files })
  // Show why rewriting the option would expose the generated sidecar to the test.
  const root = mkdtempSync(join(tmpdir(), "foldkit-glob-options-"))
  try {
    for (const path of corpus.files) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), "") }
    const selected = pattern => [...globSync("**/*", { cwd: root, exclude: [pattern] })].filter(p => statSync(join(root, p)).isFile()).sort()
    const before = selected("page/**/*.ts")
    renameSync(join(root, "page/main.ts"), join(root, "page/main.vibe"))
    writeFileSync(join(root, "page/main.d.vibe.ts"), "")
    const unsafe = selected("page/!(*.d.vibe).{ts,vibe}")
    assert.ok(unsafe.includes("page/main.d.vibe.ts"))
    assert.notDeepEqual(unsafe, before)
  } finally { rmSync(root, { recursive: true, force: true }) }
  assert.equal(result.text, corpus.text)
  assert.equal(result.edits.length, 0)
  assert.ok(result.warnings.length)
})

test("generated glob argument and option positions require a known matching contract", () => {
  // Decided detail 278: selected names and counts must remain equal; no waiver.
  fc.assert(fc.property(fc.constantFrom("globSync", "collect"), fc.constantFrom("'node:fs'", "'glob'"),
    fc.constantFrom("{}", "{ cwd: 'elsewhere' }", "{ exclude: ['page/**/*.ts'] }", "{ dot: true }", "settings"),
    fc.boolean(), (name, module, options, array) => {
      const pattern = array ? "['page/**/*.ts']" : "'page/**/*.ts'"
      const source = "import { globSync as " + name + " } from " + module + "; const files = " + name + "(" + pattern + ", " + options + ")"
      const changed = rewriteSourceLiterals(ts, source, "collector.ts", [{ from: "page/main.ts", to: "page/main.vibe" }], { inventory: corpus.files })
      assert.equal(changed.text, source)
      assert.equal(changed.edits.length, 0)
    }), { seed: 6794272, numRuns: 200 })
})

test("a sole recognized pattern argument still receives a selected-set proof", () => {
  const source = "import { globSync } from 'node:fs'; const files = globSync('page/**/*.ts')"
  const changed = rewriteSourceLiterals(ts, source, "collector.ts", [{ from: "page/main.ts", to: "page/main.vibe" }], { inventory: corpus.files })
  assert.equal(changed.edits.length, 1)
  assert.equal(changed.selectorChecks[0].pass, true)
})

test("nested pattern transforms, exclusions and spreads stay outside a literal selector proof", () => {
  for (const argument of ["normalize('page/**/*.ts')", "['page/**/*.ts', '!page/private.ts']", "['page/**/*.ts', ...otherPatterns]"]) {
    const source = "import { globSync } from 'node:fs'; const files = globSync(" + argument + ")"
    const changed = rewriteSourceLiterals(ts, source, "collector.ts", [{ from: "page/main.ts", to: "page/main.vibe" }], { inventory: corpus.files })
    assert.equal(changed.text, source)
    assert.equal(changed.edits.length, 0)
  }
})

test("exact source filenames in glob calls require and retain the same proof and revert bookkeeping", () => {
  const renames = [{ from: "page/main.ts", to: "page/main.vibe" }]
  const source = "import { globSync } from 'node:fs'; const files = globSync('page/main.ts')"
  const changed = rewriteSourceLiterals(ts, source, "collector.ts", renames, { inventory: corpus.files })
  assert.equal(changed.edits.length, 1)
  assert.equal(changed.edits[0].selectorKind, "source-glob")
  assert.equal(changed.selectorChecks[0].pass, true)
  const receipt = { renames, referenceEdits: changed.edits, selectorChecks: changed.selectorChecks }
  assert.equal(checkSelectorEdits(receipt, corpus.files).every(c => c.pass), true)
  assert.equal(checkSelectorEdits({ ...receipt, selectorChecks: [] }, corpus.files)[0].pass, false)
  for (const options of ["{}", "{ exclude: ['page/main.ts'] }", "settings"]) {
    const text = source.replace("'page/main.ts')", "'page/main.ts', " + options + ")")
    assert.equal(rewriteSourceLiterals(ts, text, "collector.ts", renames, { inventory: corpus.files }).text, text)
  }
  const root = mkdtempSync(join(tmpdir(), "foldkit-exact-selector-"))
  try {
    writeFileSync(join(root, "collector.ts"), changed.text)
    restoreSourceLiterals(ts, root, changed.edits, "page/main.ts", renames)
    assert.equal(readFileSync(join(root, "collector.ts"), "utf8"), source)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("selector receipts recheck the current literal rather than certifying stale repaired source", () => {
  const source = "const files = import.meta.glob('page/**/*.ts')"
  const renames = [{ from: "page/main.ts", to: "page/main.vibe" }]
  const catalog = [...corpus.files, "collector.ts"]
  const changed = rewriteSourceLiterals(ts, source, "collector.ts", renames, { inventory: catalog })
  const receipt = { renames, referenceEdits: changed.edits, selectorChecks: changed.selectorChecks }
  const current = catalog.map(p => p === "page/main.ts" ? "page/main.vibe" : p)
  assert.equal(checkSelectorEdits(receipt, current, { ts, read: () => changed.text }).every(c => c.pass), true)
  const broadened = changed.text.replace(changed.edits[0].to, "**/*")
  assert.equal(checkSelectorEdits(receipt, current, { ts, read: () => broadened })[0].pass, false)
})

test("generated repair mutations cannot reuse a proof for another current selector", () => {
  // Will's selected-set identity rule applies to the final source, not merely its journal.
  fc.assert(fc.property(fc.constantFrom("**/*", "page/**/*", "page/**/*.ts"), fc.integer({ min: 1, max: 4 }),
    (replacement, count) => {
      const source = "export function collect() { " + Array.from({ length: count }, () => "import.meta.glob('page/**/*.ts');").join(" ") + " }"
      const renames = [{ from: "page/main.ts", to: "page/main.vibe" }]
      const changed = rewriteSourceLiterals(ts, source, "collector.ts", renames, { inventory: corpus.files })
      const receipt = { renames, referenceEdits: changed.edits, selectorChecks: changed.selectorChecks }
      const files = ["page/main.vibe", "page/static.js", "collector.ts"]
      assert.equal(checkSelectorEdits(receipt, files, { ts, read: () => changed.text }).every(c => c.pass), true)
      const repaired = changed.text.replace(changed.edits[0].to, replacement)
      assert.equal(checkSelectorEdits(receipt, files, { ts, read: () => repaired }).every(c => c.pass), false)
    }), { seed: 6794273, numRuns: 120 })
})

test("a live proof also retains default glob options and the extension-list sidecar guard", () => {
  const renames = [{ from: "page/main.ts", to: "page/main.vibe" }]
  const files = ["page/main.ts", "collector.ts"]
  for (const source of [
    "const files = import.meta.glob('page/**/*.ts')",
    'const extensions = new Set([".ts"]); const accepts = (path: string): boolean => !path.endsWith(".d.vibe.ts") && extensions.has(path.slice(path.lastIndexOf(".")))',
  ]) {
    const changed = rewriteSourceLiterals(ts, source, "collector.ts", renames, { inventory: files })
    assert.equal(changed.edits.length, 1)
    const receipt = { renames, referenceEdits: changed.edits, selectorChecks: changed.selectorChecks }
    const current = ["page/main.vibe", "collector.ts"]
    assert.equal(checkSelectorEdits(receipt, current, { ts, read: () => changed.text }).every(c => c.pass), true)
    const repaired = source.includes("extensions")
      ? changed.text.replace('!path.endsWith(".d.vibe.ts") && ', "")
      : changed.text.replace(")", ", { cwd: 'elsewhere' })")
    assert.equal(checkSelectorEdits(receipt, current, { ts, read: () => repaired }).every(c => c.pass), false)
  }
})

test("extension proof binds the guard to the actual filename and a standard extension extraction", () => {
  const renames = [{ from: "page/main.ts", to: "page/main.vibe" }]
  for (const source of [
    'function collect(a, data) { const extensions = [".ts"]; return !a.endsWith(".d.vibe.ts") && extensions.includes(data.slice(data.lastIndexOf("."))) }',
    'function collect(file) { const extensions = [".ts"]; return !file.endsWith(".d.vibe.ts") && extensions.includes(extensionFor(file)) }',
    'function collect(file) { const extensions = [".ts"]; return !file.endsWith(".d.vibe.ts") && transform(extensions.includes(file.slice(file.lastIndexOf(".")))) }',
    'function collect(file) { const extensions = new CustomSet([".ts"]); return !file.endsWith(".d.vibe.ts") && extensions.has(file.slice(file.lastIndexOf("."))) }',
    'function collect(file) { const extensions = [".ts"]; return !file.endsWith(".d.vibe.ts") && (file = "elsewhere.ts", extensions.includes(file.slice(file.lastIndexOf(".")))) }',
    'class Set {}\nfunction collect(file) { const extensions = new Set([".ts"]); return !file.endsWith(".d.vibe.ts") && extensions.has(file.slice(file.lastIndexOf("."))) }',
  ]) {
    const changed = rewriteSourceLiterals(ts, source, "collector.ts", renames, { inventory: corpus.files })
    assert.equal(changed.text, source)
    assert.equal(changed.edits.length, 0)
  }
})

test("generated substring-related names cannot forge the sidecar guard's filename identity", () => {
  // The 04:40Z equality ruling includes generated sidecars; a substring is not a binding.
  fc.assert(fc.property(fc.constantFrom("a", "x", "f"), fc.constantFrom("path", "name", "file"), (guard, suffix) => {
    const other = guard + suffix
    const source = "function collect(" + guard + ", " + other + ") { const extensions = ['.ts']; return !" + guard +
      ".endsWith('.d.vibe.ts') && extensions.includes(" + other + ".slice(" + other + ".lastIndexOf('.'))) }"
    const changed = rewriteSourceLiterals(ts, source, "collector.ts", [{ from: "page/main.ts", to: "page/main.vibe" }], { inventory: corpus.files })
    assert.equal(changed.edits.length, 0)
  }), { seed: 6794274, numRuns: 100 })
})

test("literal proof indexing stays bounded beside thousands of brace arrays and receiver calls", () => {
  const data = Array.from({ length: 4000 }, (_, i) => "const data" + i + " = Object.freeze(['{alpha,beta,gamma}']);").join("\n")
  const source = "import { globSync } from 'node:fs';\n" + data +
    "\nconst pages = globSync('page/**/*.ts');" +
    '\nfunction collect(file) { const extensions = new Set([".ts"]); return !file.endsWith(".d.vibe.ts") && extensions.has(file.slice(file.lastIndexOf("."))) }'
  const start = performance.now()
  const changed = rewriteSourceLiterals(ts, source, "collector.ts", [{ from: "page/main.ts", to: "page/main.vibe" }], { inventory: corpus.files })
  const elapsed = performance.now() - start
  assert.equal(changed.edits.length, 2)
  assert.ok(elapsed < 5000, "bounded selector indexing took " + elapsed + "ms")
})

test("legacy exact filename glob receipts cannot bypass the original selected-set proof", () => {
  const renames = [{ from: "page/main.ts", to: "page/main.vibe" }]
  const changed = rewriteSourceLiterals(ts, "const files = import.meta.glob('page/main.ts')", "collector.ts", renames, { inventory: corpus.files })
  const edits = changed.edits.map(({ selectorKind, ...edit }) => edit)
  const receipt = { renames, referenceEdits: edits, selectorChecks: [] }
  const checked = checkSelectorEdits(receipt, ["page/main.vibe", "page/static.js", "collector.ts"], { ts, read: () => changed.text })
  assert.equal(checked.length, 1)
  assert.equal(checked[0].pass, false)
  const ordinary = rewriteSourceLiterals(ts, "const file = 'page/main.ts'", "collector.ts", renames)
  assert.deepEqual(checkSelectorEdits({ renames, referenceEdits: ordinary.edits }, ["page/main.vibe", "collector.ts"], { ts, read: () => ordinary.text }), [])
})

test("a workspace package cwd cannot be omitted from the selected-set proof", () => {
  const { source, files: inventory } = corpus.packageCwd
  const changed = rewriteSourceLiterals(ts, source, "tools/collector.ts", [{ from: "src/main.ts", to: "src/main.vibe" }], { inventory })
  const root = mkdtempSync(join(tmpdir(), "foldkit-package-cwd-"))
  try {
    for (const path of inventory) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), "") }
    const cwd = join(root, "packages/other")
    const before = [...globSync("src/**/*.ts", { cwd })].sort()
    renameSync(join(root, "src/main.ts"), join(root, "src/main.vibe"))
    const after = [...globSync("src/**/!(*.d.vibe).{ts,vibe}", { cwd })].sort()
    assert.notDeepEqual(after, before, "the omitted cwd would collect an unrelated native module")
  } finally { rmSync(root, { recursive: true, force: true }) }
  assert.equal(changed.edits.length, 0)
  assert.equal(changed.text, source)
  assert.ok(changed.selectorChecks.some(proof => proof.contexts.some(c => c.base === "packages/other" && !c.pass)))
})

test("nested package roots and ancestor cwd variants retain exact source names", () => {
  // Detail 278 requires the same selected filenames and count in every proven cwd.
  fc.assert(fc.property(fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/), fc.boolean(), (name, extra) => {
    const base = "packages/" + name
    const source = "import { globSync } from 'node:fs'; const files = globSync('src/**/*.ts')"
    const inventory = [base + "/package.json", base + "/src/main.ts", base + "/test/collector.ts"]
    if (extra) inventory.push(base + "/src/already.vibe")
    const changed = rewriteSourceLiterals(ts, source, base + "/test/collector.ts",
      [{ from: base + "/src/main.ts", to: base + "/src/main.vibe" }], { inventory })
    assert.equal(changed.edits.length, extra ? 0 : 1)
    if (!extra) assert.ok(changed.selectorChecks[0].contexts.some(c => c.base === base && c.beforeCount === 1 && c.afterCount === 1))
  }), { seed: 6794275, numRuns: 100 })
})
