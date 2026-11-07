// A saved source above the package (outside-root-absent-source) can import an
// already-native sibling. The native compiler wrote that sibling's sidecar
// beside it, and stock TypeScript reads `./model.vibe` through that sidecar;
// the comparison projection must keep it, or the unchanged API fails TS2307.
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { compareDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"

const ts = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("typescript")
const manifest = { private: true, type: "module" }
const model = "export interface Box<T> { readonly value: T }\n"
const helper = 'import type { Box } from "./model.vibe";\nexport const allowed = (): Box<number> => ({ value: 1 });\n'
const config = 'export { allowed } from "../../scripts/lib/helper.ts";\n'
const layout = { category: "error", code: "TS5011", file: "apps/server/tsconfig.json", line: 2, column: 3,
  message: "The common source directory of 'tsconfig.json' is '../..'. The 'rootDir' setting must be explicitly set to this or another path to adjust your output's file layout.", notes: [] }
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }

function fixture(check, { sidecar = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "saved-source-native-siblings-"))
  try {
    put(join(root, "apps/server/package.json"), JSON.stringify(manifest))
    put(join(root, "apps/server/tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true, allowImportingTsExtensions: true, allowArbitraryExtensions: true, rewriteRelativeImportExtensions: true }, include: ["vite.config.ts", "../../scripts/lib"] }))
    put(join(root, "apps/server/vite.config.ts"), config)
    put(join(root, "scripts/package.json"), JSON.stringify(manifest))
    put(join(root, "scripts/lib/model.vibe"), model)
    if (sidecar) put(join(root, "scripts/lib/model.d.vibe.ts"), model)
    return check(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

function snapshot(root, name, { source = helper, native = model } = {}) {
  const dir = join(root, name)
  put(join(root, "scripts/lib/helper.ts"), source)
  put(join(root, "scripts/lib/model.vibe"), native)
  if (native !== model) put(join(root, "scripts/lib/model.d.vibe.ts"), native)
  put(join(dir, "vite.config.d.ts"), config)
  recordDeclarationSurface(ts, dir, join(root, "apps/server"), [{ tsconfig: "tsconfig.json", prefix: "." }], manifest,
    { emitDiagnostics: [layout], emitRoot: root })
  return dir
}
const compare = (a, b) => compareDeclarations(ts, a, b, { canonical: true, includePrivate: true })
const blockers = result => result.environmentDiagnostics.filter(d => d.blocking)

test("a saved source above the package reads its native sibling through the sidecar", () => fixture(root => {
  const result = compare(snapshot(root, "before"), snapshot(root, "after"))
  assert.deepEqual(blockers(result), [], JSON.stringify(result.environmentDiagnostics))
  assert.equal(result.comparisonComplete, true)
  assert.equal(result.identical, true)
}))

test("a changed native sibling type is a type difference in the saved source", () => fixture(root => {
  const changed = "export interface Box<T> { readonly value: T; readonly tag?: string }\n"
  const result = compare(snapshot(root, "before"), snapshot(root, "after", { native: changed }))
  assert.equal(result.comparisonComplete, true, JSON.stringify(blockers(result)))
  assert.equal(result.identical, false)
  assert.ok(result.typeDifferences.some(d => d.export === "allowed"), JSON.stringify(result.typeDifferences))
}))

test("a native sibling with no sidecar still blocks the comparison", () => fixture(root => {
  const result = compare(snapshot(root, "before"), snapshot(root, "after"))
  assert.equal(result.comparisonComplete, false)
  assert.ok(blockers(result).some(d => /TS2307/.test(d.diagnostic)), JSON.stringify(result.environmentDiagnostics))
}, { sidecar: false }))
