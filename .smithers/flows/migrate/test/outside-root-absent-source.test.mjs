// Without rootDir, a project including a file above its tsconfig fails emit
// with TS5011 on tsconfig.json and writes that file's declaration outside the
// snapshot. The snapshot keeps the file's source, so an export reaching it is
// compared instead of failing on an unresolvable relative import.
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { compareDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"

const ts = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("typescript")
const manifest = { private: true, type: "module" }
const helper = "export const allowed = (name: string): boolean => name.length > 0;\n"
const config = 'import { allowed } from "../../scripts/lib/helper.ts";\nexport { allowed };\n'
const layout = { category: "error", code: "TS5011", file: "apps/server/tsconfig.json", line: 2, column: 3,
  message: "The common source directory of 'tsconfig.json' is '../..'. The 'rootDir' setting must be explicitly set to this or another path to adjust your output's file layout.", notes: [] }
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }

function fixture(check) {
  const root = mkdtempSync(join(tmpdir(), "outside-root-absent-source-"))
  try {
    put(join(root, "apps/server/package.json"), JSON.stringify(manifest))
    put(join(root, "apps/server/tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true }, include: ["vite.config.ts", "../../scripts/lib"] }))
    put(join(root, "apps/server/vite.config.ts"), config)
    return check(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

// What native emit wrote into the snapshot: the in-root declaration only.
function snapshot(root, name, { source = helper, diagnostics = [layout] } = {}) {
  const dir = join(root, name)
  put(join(root, "scripts/lib/helper.ts"), source)
  put(join(dir, "vite.config.d.ts"), config)
  recordDeclarationSurface(ts, dir, join(root, "apps/server"), [{ tsconfig: "tsconfig.json", prefix: "." }], manifest,
    { emitDiagnostics: diagnostics, emitRoot: root })
  return dir
}
const compare = (a, b) => compareDeclarations(ts, a, b, { canonical: true, includePrivate: true })
const blockers = result => result.environmentDiagnostics.filter(d => d.blocking)

test("a re-export of a file above the tsconfig compares through its saved source", () => fixture(root => {
  const result = compare(snapshot(root, "before"), snapshot(root, "after"))
  assert.deepEqual(blockers(result), [], JSON.stringify(result.environmentDiagnostics))
  assert.equal(result.comparisonComplete, true)
  assert.equal(result.identical, true)
  assert.deepEqual(result.absentDeclarations.map(d => [d.declaration, d.comparedFromSource]),
    [["../../scripts/lib/helper.d.ts", true]])
}))

test("a changed type in the file above the tsconfig is a type difference", () => fixture(root => {
  const result = compare(snapshot(root, "before"),
    snapshot(root, "after", { source: helper.replace("(name: string)", "(name: number)").replace("name.length > 0", "name > 0") }))
  assert.equal(result.comparisonComplete, true, JSON.stringify(blockers(result)))
  assert.equal(result.identical, false)
  assert.ok(result.typeDifferences.some(d => d.export === "allowed"), JSON.stringify(result.typeDifferences))
}))

test("without a layout error the missing declaration still blocks the comparison", () => fixture(root => {
  const result = compare(snapshot(root, "before", { diagnostics: [] }), snapshot(root, "after", { diagnostics: [] }))
  assert.equal(result.comparisonComplete, false)
  assert.ok(blockers(result).some(d => /TS2307/.test(d.diagnostic)), JSON.stringify(result.environmentDiagnostics))
}))

test("a body error in the saved source above the tsconfig blocks the comparison", () => fixture(root => {
  const broken = helper + 'const wrong: number = "text"\nexport { wrong }\n'
  const result = compare(snapshot(root, "before", { source: broken }), snapshot(root, "after", { source: broken }))
  assert.equal(result.comparisonComplete, false)
  assert.ok(blockers(result).some(d => /TS2322/.test(d.diagnostic)), JSON.stringify(result.environmentDiagnostics))
}))
