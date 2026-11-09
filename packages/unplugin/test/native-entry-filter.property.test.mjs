import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { migratedImports } from "../src/bun-migrated-imports.js"

const corpus = JSON.parse(readFileSync(new URL("./property-regressions/opencode-native-bun-entrypoints.json", import.meta.url), "utf8"))

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "native-entry-filter-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [name, text] of Object.entries(files)) {
    const file = join(root, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  return root
}

function hook(config) {
  let registered
  migratedImports({ config, onResolve(options, callback) { registered = { ...options, callback } } })
  return registered
}

test("native Bun entrypoints bypass the migrated TypeScript resolve filter", t => {
  const root = fixture(t, Object.fromEntries(corpus.entries.map(name => [name, "export const value = 1\n"])))
  const entries = corpus.entries.map(name => join(root, name))
  const registered = hook({ entrypoints: entries })
  for (const entry of entries) assert.equal(registered.filter.test(entry), false, entry)
})

test("generated native Bun entrypoint names keep native resolution", t => {
  fc.assert(fc.property(
    fc.array(fc.record({
      name: fc.constantFrom("plain", "with space", "leaf-雪", "x+y", "[entry]", "(entry)", "cash$"),
      depth: fc.integer({ min: 0, max: 3 }),
      form: fc.constantFrom("absolute", "relative", "dot-relative"),
    }), { minLength: 1, maxLength: 8 }),
    cells => {
      const names = cells.map((cell, i) => "nested/".repeat(cell.depth) + cell.name + "-" + i + ".ts")
      const root = fixture(t, Object.fromEntries(names.map(name => [name, "export const value = 1\n"])))
      const absolute = names.map(name => join(root, name))
      const entrypoints = absolute.map((name, i) => cells[i].form === "absolute" ? name
        : (cells[i].form === "dot-relative" ? "./" : "") + relative(process.cwd(), name))
      const registered = hook({ entrypoints })
      for (const entry of absolute) assert.equal(registered.filter.test(entry), false, entry)
      assert.equal(registered.filter.test("./missing.ts"), true)
      assert.equal(registered.filter.test("./types.d.ts"), false)
      assert.equal(registered.filter.test("./native.js"), false)
    }
  ), { seed: 751309, numRuns: 128 })
})

test("native Bun entrypoint exclusions preserve relative migrated imports in other directories", t => {
  const root = fixture(t, {
    "src/main.ts": "export const value = 1\n",
    "nested/src/main.vibe": "export const value = 2\n",
  })
  const previous = process.cwd()
  let registered
  try {
    process.chdir(root)
    registered = hook({ entrypoints: ["./src/main.ts"] })
  } finally {
    process.chdir(previous)
  }
  const importer = join(root, "nested", "reader.ts")
  assert.equal(registered.filter.test(join(root, "src/main.ts")), false)
  assert.equal(registered.filter.test("./src/main.ts"), true)
  assert.deepEqual(registered.callback({ path: "./src/main.ts", importer }), { path: join(root, "nested/src/main.vibe") })
})

test("missing Bun entrypoints remain available for migrated-source resolution", t => {
  const root = fixture(t, { "src/main.vibe": "export const value = 2\n" })
  const entry = join(root, "src/main.ts")
  const registered = hook({ entrypoints: [entry] })
  assert.equal(registered.filter.test(entry), true)
  assert.deepEqual(registered.callback({ path: entry, importer: join(root, "reader.ts") }), { path: join(root, "src/main.vibe") })
})
