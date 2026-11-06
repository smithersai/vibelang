// TS7056 stops declaration emit for a module whose checker type is still fine.
// A snapshot keeps that module's source, and the comparison reads it, so an
// export reaching the module is compared instead of being unavailable.
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { compareDeclarations, recordDeclarationSurface, sidecarChanges } from "../lib/declarations.mjs"

const ts = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("typescript")
const manifest = { name: "absent-source", type: "module", exports: { "./a": { types: "./src/a.d.ts" }, "./big": { types: "./src/big.d.ts" } } }
const declaration = 'import type { Big, Failure } from "./big.ts";\nexport declare const big: Big;\nexport declare const failure: Failure;\nexport declare const plain: number;\n'
const source = 'export const big = { value: 1, label: "one" }\nexport type Big = typeof big\nexport class Failure extends Error { readonly tag = "failure" as const }\n'
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
const emitted = [{ category: "error", code: "TS7056", file: "pkg/src/big.ts", line: 1, column: 14, message: "too long", notes: [] }]

function snapshot(root, name, big = source, a = declaration, shape = manifest) {
  const dir = join(root, name)
  put(join(root, "pkg/src/big.ts"), big)
  put(join(dir, "src/a.d.ts"), a)
  recordDeclarationSurface(ts, dir, join(root, "pkg"), [{ tsconfig: "tsconfig.json", prefix: "." }], shape,
    { emitDiagnostics: emitted, emitRoot: root })
  return dir
}

function fixture(check) {
  const root = mkdtempSync(join(tmpdir(), "absent-source-oracle-"))
  try {
    put(join(root, "pkg/package.json"), JSON.stringify(manifest))
    put(join(root, "pkg/tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, types: [], target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", allowImportingTsExtensions: true, noEmit: true, declaration: true }, include: ["src"] }))
    put(join(root, "pkg/src/a.ts"), 'import type { Big, Failure } from "./big.ts";\nexport declare const big: Big;\nexport declare const failure: Failure;\nexport const plain = 1;\n')
    return check(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const compare = (a, b, options = {}) => compareDeclarations(ts, a, b, { ...options })
const blockers = result => result.environmentDiagnostics.filter(d => d.blocking)

test("an export reaching a module without a declaration is compared through its source", () => fixture(root => {
  const result = compare(snapshot(root, "before"), snapshot(root, "after"))
  assert.deepEqual(blockers(result), [], JSON.stringify(result.environmentDiagnostics))
  assert.equal(result.comparisonComplete, true)
  assert.equal(result.identical, true)
  assert.deepEqual(result.absentDeclarations.map(d => [d.declaration, d.comparedFromSource]), [["src/big.d.ts", true]])
}))

test("a type changed inside the absent module is a type difference", () => fixture(root => {
  const result = compare(snapshot(root, "before"), snapshot(root, "after", source.replace("value: 1", 'value: "1"')))
  assert.equal(result.comparisonComplete, true, JSON.stringify(blockers(result)))
  assert.equal(result.identical, false)
  assert.ok(result.typeDifferences.some(d => d.export === "big"), JSON.stringify(result.typeDifferences))
}))

test("a class of the absent module keeps its identity across the snapshots", () => fixture(root => {
  const changed = source.replace('"failure" as const', '"other" as const')
  const result = compare(snapshot(root, "before"), snapshot(root, "after", changed))
  assert.ok(result.typeDifferences.some(d => d.export === "failure"), JSON.stringify(result))
}))

test("a name removed from the absent module's own entry point is a name difference", () => fixture(root => {
  const result = compare(snapshot(root, "before"), snapshot(root, "after", source + "export const extra = 1\n"))
  assert.equal(result.identical, false)
  assert.ok(result.nameDifferences.some(d => /extra/.test(JSON.stringify(d))), JSON.stringify(result.nameDifferences))
}))

test("a private package compares the absent module's own exports", () => fixture(root => {
  const shape = { name: "absent-source", type: "module" }
  const reached = source + "export const unreached = 1\n"
  const same = compare(snapshot(root, "before", reached, declaration, shape), snapshot(root, "after", reached, declaration, shape), { includePrivate: true })
  assert.equal(same.identical, true, JSON.stringify(same.environmentDiagnostics))
  const changed = compare(snapshot(root, "before", reached, declaration, shape),
    snapshot(root, "after", reached.replace("unreached = 1", "unreached = 2"), declaration, shape), { includePrivate: true })
  assert.ok(changed.typeDifferences.some(d => d.export === "unreached"), JSON.stringify(changed.typeDifferences))
}))

test("a body error in the absent source blocks the comparison", () => fixture(root => {
  const broken = source + 'const wrong: number = "text"\nexport { wrong }\n'
  const result = compare(snapshot(root, "before", broken), snapshot(root, "after", broken))
  assert.equal(result.identical, false)
  assert.equal(result.comparisonComplete, false)
  assert.ok(blockers(result).some(d => /TS2322/.test(d.diagnostic)), JSON.stringify(result.environmentDiagnostics))
}))

test("a source saved on one side only leaves the export unavailable", () => fixture(root => {
  const before = snapshot(root, "before"), after = snapshot(root, "after")
  const metadata = join(before, "public-surface.json"), surface = JSON.parse(readFileSync(metadata, "utf8"))
  delete surface.apiMetadata.absentSources
  writeFileSync(metadata, JSON.stringify(surface))
  const result = compare(before, after)
  assert.equal(result.identical, false)
  assert.equal(result.comparisonComplete, false)
  assert.ok(blockers(result).some(d => d.export === "big" && d.scope === "export"), JSON.stringify(blockers(result)))
}))

test("a later record without emit diagnostics keeps the saved source", () => fixture(root => {
  const dir = snapshot(root, "after")
  rmSync(join(root, "pkg/src/big.ts"))
  const surface = recordDeclarationSurface(ts, dir, join(root, "pkg"), [{ tsconfig: "tsconfig.json", prefix: "." }], manifest)
  assert.deepEqual(Object.keys(surface.apiMetadata.absentSources), ["src/big.d.ts"])
}))

test("recording again from the tree saves the source a frozen snapshot lacks", () => fixture(root => {
  const dir = snapshot(root, "after")
  const metadata = join(dir, "public-surface.json"), saved = JSON.parse(readFileSync(metadata, "utf8"))
  delete saved.apiMetadata.absentSources
  writeFileSync(metadata, JSON.stringify(saved))
  const surface = recordDeclarationSurface(ts, dir, join(root, "pkg"), [{ tsconfig: "tsconfig.json", prefix: "." }], manifest)
  assert.deepEqual(Object.keys(surface.apiMetadata.absentSources), ["src/big.d.ts"])
}))

test("setup compares an earlier sidecar that reaches the absent module", () => fixture(root => {
  const dir = snapshot(root, "after")
  const same = sidecarChanges(ts, { "src/a.d.vibe.ts": declaration }, dir)
  assert.deepEqual([same.changed, same.unavailable], [[], undefined], JSON.stringify(same))
  const changed = sidecarChanges(ts, { "src/a.d.vibe.ts": declaration.replace("big: Big", "big: string") }, dir)
  assert.deepEqual(changed.changed.map(item => item.file), ["src/a.d.vibe.ts"], JSON.stringify(changed))
}))
