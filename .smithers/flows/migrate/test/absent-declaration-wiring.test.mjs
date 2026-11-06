// TS7056 leaves a module with no declaration on both sides. A snapshot without
// its saved source (see absent-source-oracle) must not stop setup, the exports
// that reach it stay unavailable, and nothing else is excused.
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { compareDeclarations, recordDeclarationSurface, sidecarChanges } from "../lib/declarations.mjs"

const ts = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("typescript")
const manifest = { name: "absent-wiring", type: "module", exports: { "./a": { types: "./src/a.d.ts" } } }
const declaration = 'import type { Big } from "./big.ts";\nexport declare const big: Big;\nexport declare const plain: number;\n'
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
const emitted = (line = 3) => [{ category: "error", code: "TS7056", file: "pkg/src/big.ts", line, column: 1, message: "too long", notes: [] }]

function snapshot(root, name, text, diagnostics) {
  const dir = join(root, name)
  put(join(dir, "src/a.d.ts"), text)
  recordDeclarationSurface(ts, dir, join(root, "pkg"), [{ tsconfig: "tsconfig.json", prefix: "." }], manifest,
    { emitDiagnostics: diagnostics, emitRoot: root })
  const recorded = join(dir, "public-surface.json"), surface = JSON.parse(readFileSync(recorded, "utf8"))
  delete surface.apiMetadata.absentSources
  writeFileSync(recorded, JSON.stringify(surface))
  return dir
}

function fixture(check) {
  const root = mkdtempSync(join(tmpdir(), "absent-declaration-wiring-"))
  try {
    put(join(root, "pkg/package.json"), JSON.stringify(manifest))
    put(join(root, "pkg/tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, types: [], target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", allowImportingTsExtensions: true, noEmit: true, rootDir: "." }, include: ["src"] }))
    put(join(root, "pkg/src/a.ts"), 'import type { Big } from "./big.ts";\nexport declare const big: Big;\nexport const plain = 1;\n')
    put(join(root, "pkg/src/big.ts"), "export type Big = string;\n")
    return check(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("setup records why a declaration is absent", () => fixture(root => {
  const dir = snapshot(root, "after", declaration, emitted())
  const surface = recordDeclarationSurface(ts, dir, join(root, "pkg"), [{ tsconfig: "tsconfig.json", prefix: "." }], manifest,
    { emitDiagnostics: emitted(), emitRoot: root })
  assert.deepEqual(surface.apiMetadata.absentDeclarations, { "src/big.d.ts": [{ code: "TS7056", file: "pkg/src/big.ts", line: 3, column: 1 }] })
}))

test("an earlier sidecar reaching an absent declaration leaves setup running and names the export", () => fixture(root => {
  const dir = snapshot(root, "after", declaration, emitted())
  const result = sidecarChanges(ts, { "src/a.d.vibe.ts": declaration }, dir)
  assert.equal(result.comparisonComplete, undefined, JSON.stringify(result))
  assert.deepEqual(result.changed, [], JSON.stringify(result))
  assert.deepEqual(result.unavailable.map(item => item.entrypoint + "#" + item.export), ["src/a.d.vibe.ts#big"], JSON.stringify(result))
}))

test("an earlier sidecar still reports a change an absence does not explain", () => fixture(root => {
  const dir = snapshot(root, "after", declaration, emitted())
  const result = sidecarChanges(ts, { "src/a.d.vibe.ts": declaration.replace("plain: number", "plain: string") }, dir)
  assert.deepEqual(result.changed.map(item => item.file), ["src/a.d.vibe.ts"], JSON.stringify(result))
}))

test("an absent declaration without a recorded reason stops setup as before", () => fixture(root => {
  const dir = snapshot(root, "after", declaration, undefined)
  const result = sidecarChanges(ts, { "src/a.d.vibe.ts": declaration }, dir)
  assert.equal(result.comparisonComplete, false, JSON.stringify(result))
}))

test("a package comparison never reads an absence as identical", () => fixture(root => {
  const result = compareDeclarations(ts, snapshot(root, "before", declaration, emitted()), snapshot(root, "after", declaration, emitted()), { includePrivate: true })
  assert.equal(result.comparisonComplete, false, JSON.stringify(result))
  assert.equal(result.identical, false, JSON.stringify(result))
  const blockers = result.environmentDiagnostics.filter(d => d.blocking)
  assert.ok(blockers.length && blockers.every(d => d.scope === "export"), JSON.stringify(blockers))
}))

test("a different emit reason is unavailable, and the reason is reported", () => fixture(root => {
  const result = compareDeclarations(ts, snapshot(root, "before", declaration, emitted(3)), snapshot(root, "after", declaration, emitted(9)), { includePrivate: true })
  assert.equal(result.identical, false, JSON.stringify(result))
  assert.ok(result.environmentDiagnostics.some(d => /different emit diagnostics/.test(d.diagnostic)), JSON.stringify(result))
}))
