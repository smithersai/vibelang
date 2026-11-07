// A saved source above the package (outside-root-absent-source) resolves its
// bare imports from its own directories' node_modules, as Node and tsc do.
// The projection mirrors the package's ancestors, so a sibling package such
// as scripts/ keeps its own node_modules only if the projection links it too.
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { compareDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"

const ts = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("typescript")
const manifest = { private: true, type: "module" }
const box = "export interface Box<T> { readonly value: T }\n"
const helper = 'import type { Box } from "dep";\nexport const allowed = (): Box<number> => ({ value: 1 });\n'
const config = 'export { allowed } from "../../scripts/lib/helper.ts";\n'
const layout = { category: "error", code: "TS5011", file: "apps/server/tsconfig.json", line: 2, column: 3,
  message: "The common source directory of 'tsconfig.json' is '../..'. The 'rootDir' setting must be explicitly set to this or another path to adjust your output's file layout.", notes: [] }
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }

function fixture(check, { dep = box } = {}) {
  const root = mkdtempSync(join(tmpdir(), "saved-source-sibling-dependencies-"))
  try {
    put(join(root, "apps/server/package.json"), JSON.stringify(manifest))
    put(join(root, "apps/server/tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true }, include: ["vite.config.ts", "../../scripts/lib"] }))
    put(join(root, "apps/server/vite.config.ts"), config)
    put(join(root, "scripts/package.json"), JSON.stringify(manifest))
    put(join(root, "scripts/lib/helper.ts"), helper)
    if (dep !== null) {
      put(join(root, "scripts/node_modules/dep/package.json"), JSON.stringify({ name: "dep", version: "1.0.0", type: "module", types: "index.d.ts", exports: { ".": "./index.d.ts" } }))
      put(join(root, "scripts/node_modules/dep/index.d.ts"), dep)
    }
    return check(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

function snapshot(root, name, { source = helper } = {}) {
  const dir = join(root, name)
  put(join(root, "scripts/lib/helper.ts"), source)
  put(join(dir, "vite.config.d.ts"), config)
  recordDeclarationSurface(ts, dir, join(root, "apps/server"), [{ tsconfig: "tsconfig.json", prefix: "." }], manifest,
    { emitDiagnostics: [layout], emitRoot: root })
  return dir
}
const compare = (a, b) => compareDeclarations(ts, a, b, { canonical: true, includePrivate: true })
const blockers = result => result.environmentDiagnostics.filter(d => d.blocking)

test("a saved source above the package resolves a dependency installed beside it", () => fixture(root => {
  const result = compare(snapshot(root, "before"), snapshot(root, "after"))
  assert.deepEqual(blockers(result), [], JSON.stringify(result.environmentDiagnostics))
  assert.equal(result.comparisonComplete, true)
  assert.equal(result.identical, true)
}))

test("a changed dependency type in the saved source is a type difference", () => fixture(root => {
  const changed = helper.replace("Box<number>", "Box<string>").replace("value: 1", 'value: "1"')
  const result = compare(snapshot(root, "before"), snapshot(root, "after", { source: changed }))
  assert.equal(result.comparisonComplete, true, JSON.stringify(blockers(result)))
  assert.equal(result.identical, false)
  assert.ok(result.typeDifferences.some(d => d.export === "allowed"), JSON.stringify(result.typeDifferences))
}))

test("a dependency missing beside the saved source still blocks the comparison", () => fixture(root => {
  const result = compare(snapshot(root, "before"), snapshot(root, "after"))
  assert.equal(result.comparisonComplete, false)
  assert.ok(blockers(result).some(d => /TS2307/.test(d.diagnostic)), JSON.stringify(result.environmentDiagnostics))
}, { dep: null }))
