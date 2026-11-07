// A package's declarations may import a module of another workspace package
// by a relative path that leaves the package, as Smithers' flows import
// `../../../packages/smithers/gateway/src/RuntimeBridge.js`. The comparison
// projection mirrors only the package and its ancestors' node_modules, so
// that import failed TS2307 on both sides and blocked every export of the
// group. The projection now links the provider's directory where the import
// expects it, so the import resolves as it does in the tree.
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { compareDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const published = { name: "flows", type: "module", exports: { "./a": { types: "./src/a.d.ts" } } }
const privateShape = { name: "flows", type: "module" }
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
const consumer = (type = "Provider") => `import type { Provider } from "../../packages/gateway/src/provider.js";\nexport declare const p: ${type};\nexport declare const plain: number;\n`

function snapshot(root, name, text, shape) {
  const dir = join(root, name)
  put(join(dir, "src/a.d.ts"), text)
  recordDeclarationSurface(ts, dir, join(root, "ws/flows"), [{ tsconfig: "tsconfig.json", prefix: "." }], shape, { emitDiagnostics: [], emitRoot: root })
  return dir
}

function fixture(check, provider = "export interface Provider { readonly name: string; readonly port: number }\n") {
  const root = mkdtempSync(join(tmpdir(), "outside-provider-"))
  try {
    put(join(root, "ws/flows/package.json"), JSON.stringify(published))
    put(join(root, "ws/flows/tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, types: [], target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", noEmit: true, declaration: true }, include: ["src"] }))
    put(join(root, "ws/flows/src/a.ts"), "export {}\n")
    put(join(root, "ws/packages/gateway/package.json"), JSON.stringify({ name: "gateway", type: "module" }))
    put(join(root, "ws/packages/gateway/src/provider.ts"), provider)
    return check(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const blockers = result => result.environmentDiagnostics.filter(d => d.blocking)

for (const [label, shape] of [["published", published], ["private", privateShape]]) {
  test(`${label}: an import into another workspace package resolves in the projection`, () => fixture(root => {
    const result = compareDeclarations(ts, snapshot(root, "before", consumer(), shape), snapshot(root, "after", consumer(), shape), shape === published ? {} : { includePrivate: true })
    assert.deepEqual(blockers(result), [], JSON.stringify(result.environmentDiagnostics))
    assert.equal(result.comparisonComplete, true)
    assert.equal(result.identical, true)
  }))
  test(`${label}: a changed use of the provider is still a type difference`, () => fixture(root => {
    const result = compareDeclarations(ts, snapshot(root, "before", consumer(), shape), snapshot(root, "after", consumer("Provider | undefined"), shape), shape === published ? {} : { includePrivate: true })
    assert.equal(result.comparisonComplete, true, JSON.stringify(blockers(result)))
    assert.ok(result.typeDifferences.some(d => d.export === "p"), JSON.stringify(result.typeDifferences))
  }))
}

test("a file above the package that belongs to no other package is not linked", () => fixture(root => {
  const loose = consumer().replace("../../packages/gateway/src/provider.js", "../../loose/provider.js")
  put(join(root, "ws/loose/provider.ts"), "export interface Provider { readonly name: string }\n")
  const result = compareDeclarations(ts, snapshot(root, "before", loose, published), snapshot(root, "after", loose, published))
  assert.equal(result.comparisonComplete, false)
  assert.ok(blockers(result).some(d => /TS2307/.test(d.diagnostic)), JSON.stringify(result.environmentDiagnostics))
}))

test("an import of a provider that does not exist still fails", () => fixture(root => {
  const missing = consumer().replace("gateway/src/provider.js", "gateway/src/missing.js")
  const result = compareDeclarations(ts, snapshot(root, "before", missing, published), snapshot(root, "after", missing, published))
  assert.equal(result.comparisonComplete, false)
  assert.ok(blockers(result).some(d => /TS2307/.test(d.diagnostic)), JSON.stringify(result.environmentDiagnostics))
}))

test("the projection writes nothing into the linked provider", () => fixture(root => {
  const before = snapshot(root, "before", consumer(), published)
  compareDeclarations(ts, before, snapshot(root, "after", consumer(), published))
  const { readdirSync } = require("node:fs")
  assert.deepEqual(readdirSync(join(root, "ws/packages/gateway/src")), ["provider.ts"])
}))

// The exports reached through the provider compare exactly: identical when
// the two sides use it the same way, different otherwise.
test("property: identity through an outside provider follows the declared uses", () => fixture(root => {
  const uses = ["Provider", "Provider[]", "Provider | undefined", "Provider[\"port\"]", "Readonly<Provider>"]
  fc.assert(fc.property(fc.constantFrom(...uses), fc.constantFrom(...uses), (a, b) => {
    rmSync(join(root, "before"), { recursive: true, force: true }); rmSync(join(root, "after"), { recursive: true, force: true })
    const result = compareDeclarations(ts, snapshot(root, "before", consumer(a), published), snapshot(root, "after", consumer(b), published))
    assert.equal(result.comparisonComplete, true, JSON.stringify(blockers(result)))
    const same = a === b || [a, b].every(u => u === "Provider" || u === "Readonly<Provider>")
    assert.equal(result.identical, same, a + " / " + b + JSON.stringify(result.typeDifferences))
  }), { numRuns: 10, seed: 2307 })
}))

test("Smithers flows: command-receipts reaches the gateway's RuntimeBridge", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-flows-outside-provider.json", import.meta.url), "utf8"))
  const root = mkdtempSync(join(tmpdir(), "outside-provider-smithers-"))
  try {
    const packageDir = join(root, corpus.packageDir), shape = { name: "flows", private: true, type: "module" }
    put(join(packageDir, "package.json"), JSON.stringify(shape))
    put(join(packageDir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, types: [], target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", noEmit: true, declaration: true } }))
    put(join(root, corpus.provider), corpus.providerSource)
    put(join(root, corpus.providerPackage), JSON.stringify({ name: "@smthrs/gateway", type: "module" }))
    put(join(packageDir, corpus.declaration.replace(/\.d\.ts$/, ".ts")), "export {}\n")
    const side = (name, text) => {
      const dir = join(root, name)
      put(join(dir, corpus.declaration), text)
      recordDeclarationSurface(ts, dir, packageDir, [{ tsconfig: "tsconfig.json", prefix: "." }], shape, { emitDiagnostics: [], emitRoot: root })
      return dir
    }
    const same = compareDeclarations(ts, side("before", corpus.consumer), side("after", corpus.consumer), { includePrivate: true })
    assert.deepEqual(blockers(same), [], JSON.stringify(same.environmentDiagnostics))
    assert.equal(same.identical, true)
    const changed = compareDeclarations(ts, join(root, "before"), side("after2", corpus.consumer.replace("=> string", "=> number")), { includePrivate: true })
    assert.ok(changed.typeDifferences.some(d => d.export === "host"), JSON.stringify({ c: changed.comparisonComplete, i: changed.identical, t: changed.typeDifferences, n: changed.nameDifferences, e: changed.environmentDiagnostics }))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
