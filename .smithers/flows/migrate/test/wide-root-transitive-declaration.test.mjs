// With rootDir above the package, a declaration emitted for a transitive
// import (not an include entry) has no recorded source. The projection
// places it by the layout's directory, which names the package's own
// directory by its real name, so the path must re-enter the package.
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { compareDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"

const ts = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("typescript")
const manifest = { name: "layout-witness", private: true, type: "module" }
const schema = 'export type Status = "ready" | "stopped";\n'
const main = 'import type { Status } from "../schema/expo.graphql.ts";\nexport declare const status: Status;\n'
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }

function fixture(check) {
  const root = mkdtempSync(join(tmpdir(), "wide-root-transitive-"))
  try { return check(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

// What native emit writes under rootDir: both declarations below the root.
function snapshot(root, name, { rootDir, include = ["src"], status = schema } = {}) {
  const pkg = join(root, "apps/server")
  put(join(pkg, "package.json"), JSON.stringify(manifest))
  put(join(pkg, "schema/expo.graphql.ts"), status)
  put(join(pkg, "src/main.ts"), main)
  put(join(pkg, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", rootDir, strict: true, types: [], skipLibCheck: true, allowImportingTsExtensions: true }, include }))
  const dir = join(root, name), below = relative(join(pkg, rootDir), pkg)
  put(join(dir, "0", below, "src/main.d.ts"), main)
  put(join(dir, "0", below, "schema/expo.graphql.d.ts"), status)
  recordDeclarationSurface(ts, dir, pkg, [{ tsconfig: "tsconfig.json", prefix: "0" }], manifest, { emitDiagnostics: [], emitRoot: join(pkg, rootDir) })
  return dir
}
const compare = (a, b) => compareDeclarations(ts, a, b, { canonical: true, includePrivate: true })
const blockers = result => result.environmentDiagnostics.filter(d => d.blocking)

for (const rootDir of ["..", "../.."]) {
  test(`rootDir ${rootDir}: a transitive declaration resolves from its importer`, () => fixture(root => {
    const result = compare(snapshot(root, "before", { rootDir }), snapshot(root, "after", { rootDir }))
    assert.deepEqual(blockers(result), [], JSON.stringify(result.environmentDiagnostics))
    assert.equal(result.comparisonComplete, true)
    assert.equal(result.identical, true)
  }))

  test(`rootDir ${rootDir}: a changed transitive type is a type difference`, () => fixture(root => {
    const result = compare(snapshot(root, "before", { rootDir }),
      snapshot(root, "after", { rootDir, status: schema.replace(' | "stopped"', "") }))
    assert.equal(result.comparisonComplete, true, JSON.stringify(blockers(result)))
    assert.equal(result.identical, false)
    assert.ok(result.typeDifferences.some(d => d.export === "status"), JSON.stringify(result.typeDifferences))
  }))

  test(`rootDir ${rootDir}: an included schema compares as before`, () => fixture(root => {
    const result = compare(snapshot(root, "before", { rootDir, include: ["src", "schema"] }),
      snapshot(root, "after", { rootDir, include: ["src", "schema"] }))
    assert.equal(result.identical, true, JSON.stringify(result.environmentDiagnostics))
  }))
}

test("rootDir .: a transitive declaration resolves from its importer", () => fixture(root => {
  const result = compare(snapshot(root, "before", { rootDir: "." }), snapshot(root, "after", { rootDir: "." }))
  assert.equal(result.identical, true, JSON.stringify(result.environmentDiagnostics))
}))
