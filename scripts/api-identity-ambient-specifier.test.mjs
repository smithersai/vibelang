// A declaration that augments a module is compared by its ambient
// contribution: the augmentation and the local declarations it reaches. When
// the file is not otherwise proved equal, as when a module it imports was
// converted, that text decides. Named imports already compared without their
// extension, but an inferred `import("./work").WorkFilter` did not, so a
// declaration that only spelled it `import("./work.ts")` after a conversion
// refused the whole package ("Ambient declaration closures differ"). Smithers'
// apps/mvp router (TanStack Router's Register augmentation) stayed TypeScript
// this way.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"

const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/smithers-mvp-router-register.json", import.meta.url), "utf8"))
const put = (root, file, text) => { const p = join(root, file); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text) }
const options = { compilerOptions: { types: [], allowImportingTsExtensions: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true } }

// router: the augmenting declaration; views: a neighbour whose declaration
// changed, so router.d.ts is not proved equal as a module.
function compare(beforeRouter, afterRouter, { afterViews = "/** Views. */\n" + corpus.views } = {}) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-ambient-specifier-"))
  try {
    for (const [side, router, views] of [["a", beforeRouter, corpus.views], ["b", afterRouter, afterViews]]) {
      put(root, side + "/node_modules/base/package.json", JSON.stringify({ name: "base", version: "1.0.0", types: "index.d.ts" }))
      put(root, side + "/node_modules/base/index.d.ts", "export interface Register {}\n")
      put(root, side + "/pkg/package.json", JSON.stringify({ name: "pkg", type: "module", exports: { ".": "./index.d.ts" } }))
      put(root, side + "/pkg/index.d.ts", 'export { router } from "./router.js";\n')
      put(root, side + "/pkg/router.d.ts", router)
      put(root, side + "/pkg/views.d.ts", views)
      put(root, side + "/pkg/work.d.ts", corpus.work)
    }
    return compareApiIdentity(ts, join(root, "a/pkg"), join(root, "b/pkg"), options)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const spell = (views, work) => corpus.router.replaceAll("{views}", views).replaceAll("{work}", work)
const blockers = result => result.environmentDiagnostics.filter(d => d.blocking)

test("Smithers' router: a respelled import type in the augmentation's closure is the same closure", () => {
  const result = compare(spell("./views", "./work"), spell("./views.js", "./work.ts"))
  assert.deepEqual(blockers(result), [], JSON.stringify(result.environmentDiagnostics))
  assert.equal(result.comparisonComplete, true)
})

test("a changed type in the augmentation's closure still refuses", () => {
  const changed = spell("./views.js", "./work.ts").replace("readonly views: ViewsView", "readonly views: ViewsView | undefined")
  const result = compare(spell("./views", "./work"), changed)
  assert.ok(blockers(result).some(d => /Ambient declaration closures differ/.test(d.diagnostic)), JSON.stringify(result.environmentDiagnostics))
})

test("an import type of a different module still refuses", () => {
  const result = compare(spell("./views", "./work"), spell("./views", "./views").replace("WorkFilter", "ViewsView"))
  assert.ok(blockers(result).some(d => /Ambient declaration closures differ/.test(d.diagnostic)), JSON.stringify(result.environmentDiagnostics))
})

test("an import type of another path still refuses", () => {
  const result = compare(spell("./views", "./work"), spell("./views", "./work").replace('import("./work")', 'import("./work/index.js")'))
  assert.ok(blockers(result).some(d => /Ambient declaration closures differ/.test(d.diagnostic)), JSON.stringify(result.environmentDiagnostics))
})

// Any extension a relative specifier may carry, on either side, pairs with
// any other spelling of the same module; a different module never does.
test("property: relative import-type spellings of one module pair; other modules refuse", () => {
  const spellings = ["", ".js", ".ts", ".mjs", ".mts", ".d.ts"].filter(e => e !== ".d.ts")
  fc.assert(fc.property(fc.constantFrom(...spellings), fc.constantFrom(...spellings), fc.boolean(), (a, b, other) => {
    const before = spell("./views" + a, "./work" + a)
    const after = other ? spell("./views" + b, "./views" + b).replace("WorkFilter", "ViewsView") : spell("./views" + b, "./work" + b)
    const result = compare(before, after)
    assert.equal(blockers(result).some(d => /Ambient declaration closures differ/.test(d.diagnostic)), other, a + "/" + b + JSON.stringify(result.environmentDiagnostics))
  }), { numRuns: 8, seed: 834 })
})
