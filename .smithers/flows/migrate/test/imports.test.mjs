import assert from "node:assert/strict"
import { test } from "node:test"
import { applyEdits, effectUse, isEffectSpecifier, parseImports, resolveRelative } from "../lib/imports.mjs"

const source = `import {
  Array,
  Schema as EffectSchema,
} from 'effect'
import type { VNode } from '../snabbdom/index.js'
import { type A, type B } from "./types.js"
export const x = 1
export * from './brand.js'
export type { C } from "./c.js"
import './side-effect.js'
const lazy = () => import("./lazy.js")
`

test("parseImports finds every specifier with its offsets, without semicolons", () => {
  const found = parseImports(source)
  assert.deepEqual(found.map((i) => [i.kind, i.specifier, i.typeOnly]), [
    ["import", "effect", false],
    ["import", "../snabbdom/index.js", true],
    ["import", "./types.js", true],
    ["export", "./brand.js", false],
    ["export", "./c.js", true],
    ["import", "./side-effect.js", false],
    ["dynamic", "./lazy.js", false]
  ])
  for (const i of found) assert.equal(source.slice(i.start, i.end), i.specifier)
})

test("a declaration before an import does not swallow the import's clause", () => {
  const found = parseImports("export const a = 1\nimport type { T } from 'effect'\n")
  assert.deepEqual(found.map((i) => [i.kind, i.specifier, i.typeOnly]), [["import", "effect", true]])
})

test("effectUse tells value imports from type-only ones", () => {
  assert.equal(effectUse(parseImports("import { Effect } from 'effect'")), "values")
  assert.equal(effectUse(parseImports("import type { Effect } from 'effect'")), "types")
  assert.equal(effectUse(parseImports("import { x } from './x.js'")), "none")
  assert.equal(isEffectSpecifier("@effect/platform-browser"), true)
  assert.equal(isEffectSpecifier("effect/Schema"), true)
  assert.equal(isEffectSpecifier("effectful"), false)
})

test("resolveRelative follows .js to a .ts or .vibe source, and extensionless to index files", () => {
  const files = new Set(["src/a.ts", "src/b.vibe", "src/dir/index.ts", "src/c.tsx"])
  assert.equal(resolveRelative("src/x.ts", "./a.js", files), "src/a.ts")
  assert.equal(resolveRelative("src/x.ts", "./b.js", files), "src/b.vibe")
  assert.equal(resolveRelative("src/x.ts", "./b.vibe", files), "src/b.vibe")
  assert.equal(resolveRelative("src/x.ts", "./dir", files), "src/dir/index.ts")
  assert.equal(resolveRelative("src/x.ts", "./c.jsx", files), "src/c.tsx")
  assert.equal(resolveRelative("src/x.ts", "./missing.js", files), undefined)
  assert.equal(resolveRelative("src/x.ts", "effect", files), undefined)
})

test("applyEdits replaces from the end so offsets stay valid", () => {
  assert.equal(applyEdits("ab cd ef", [{ start: 0, end: 2, text: "AAAA" }, { start: 6, end: 8, text: "F" }]), "AAAA cd F")
})

test("directory slash imports use canonical repository keys", () => {
  assert.equal(resolveRelative("pkg/a.vibe", "./runtime/", new Set(["pkg/runtime/index.vibe"])), "pkg/runtime/index.vibe")
  assert.equal(resolveRelative("pkg/a.vibe", "./", new Set(["pkg/index.vibe"])), "pkg/index.vibe")
  assert.equal(resolveRelative("pkg/a.vibe", "../", new Set(["index.ts"])), "index.ts")
})
