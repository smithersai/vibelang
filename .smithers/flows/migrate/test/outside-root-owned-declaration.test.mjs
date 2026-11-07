// A comparison projection mirrors the package's ancestors, so a declaration
// emitted for a source above the package directory sits outside the side's
// base. It still belongs to that side: its types are compared like the
// package's own, and its errors block the comparison.
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { compareDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"

const ts = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("typescript")
const manifest = { private: true, type: "module" }
const plugin = 'import type { Plugin } from "dep";\nexport declare function plugin(): Plugin;\n'
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }

// `dep` is an installed package with an error the export never depends on
// through anything but the shared Plugin type.
function fixture(check) {
  const root = mkdtempSync(join(tmpdir(), "outside-root-owned-"))
  try {
    put(join(root, "node_modules/dep/package.json"), JSON.stringify({ name: "dep", version: "1.0.0", types: "index.d.ts" }))
    put(join(root, "node_modules/dep/index.d.ts"), 'export interface Plugin { name: string; host: import("./broken.js").Host }\n')
    put(join(root, "node_modules/dep/broken.d.ts"), "export type Host = Missing.Thing\n")
    put(join(root, "apps/web/package.json"), JSON.stringify(manifest))
    return check(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

function snapshot(root, name, { external = true, text = plugin } = {}) {
  const source = external ? "../../scripts/lib/plugin.ts" : "lib/plugin.ts"
  put(join(root, "apps/web/tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ESNext", module: "Preserve", moduleResolution: "Bundler", strict: true, types: [], rootDir: "../..", declaration: true }, files: [source] }))
  const dir = join(root, name)
  put(join(dir, external ? "scripts/lib/plugin.d.ts" : "apps/web/lib/plugin.d.ts"), text)
  put(join(root, external ? "scripts/lib/plugin.ts" : "apps/web/lib/plugin.ts"), text.replace("export declare function plugin(): Plugin;", "export function plugin(): Plugin { throw 0 }"))
  recordDeclarationSurface(ts, dir, join(root, "apps/web"), [{ tsconfig: "tsconfig.json", prefix: "." }], manifest, { emitDiagnostics: [], emitRoot: root })
  return dir
}
const compare = (a, b) => compareDeclarations(ts, a, b, { canonical: true, includePrivate: true })
const blockers = result => result.environmentDiagnostics.filter(d => d.blocking)

test("a declaration inside the package compares its shared dependency type once", () => fixture(root => {
  const result = compare(snapshot(root, "before", { external: false }), snapshot(root, "after", { external: false }))
  assert.deepEqual(blockers(result), [], JSON.stringify(result.environmentDiagnostics))
  assert.equal(result.identical, true)
}))

test("a declaration above the package compares its shared dependency type once", () => fixture(root => {
  const result = compare(snapshot(root, "before"), snapshot(root, "after"))
  assert.deepEqual(blockers(result), [], JSON.stringify(result.environmentDiagnostics))
  assert.equal(result.comparisonComplete, true)
  assert.equal(result.identical, true)
}))

test("a changed declaration above the package is a type difference", () => fixture(root => {
  const result = compare(snapshot(root, "before"), snapshot(root, "after", { text: plugin.replace("(): Plugin", "(): Plugin | undefined") }))
  assert.equal(result.comparisonComplete, true, JSON.stringify(blockers(result)))
  assert.equal(result.identical, false)
  assert.ok(result.typeDifferences.some(d => d.export === "plugin"), JSON.stringify(result.typeDifferences))
}))

test("an error in a declaration above the package blocks the comparison", () => fixture(root => {
  const broken = plugin + "declare const hidden: Missing;\nexport {};\n"
  const result = compare(snapshot(root, "before", { text: broken }), snapshot(root, "after", { text: broken }))
  assert.equal(result.comparisonComplete, false)
  assert.ok(blockers(result).some(d => /TS2304/.test(d.diagnostic)), JSON.stringify(result.environmentDiagnostics))
}))
