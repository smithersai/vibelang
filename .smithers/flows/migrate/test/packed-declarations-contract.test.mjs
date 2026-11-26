import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { comparePackedDeclarations, comparePacks, exportConditionSurface, materializePackArchive, packRepository } from "../lib/pack-policy.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const put = (root, file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

function makeTarball(root, name, files) {
  const stage = join(root, "stage-" + name)
  const pkgDir = join(stage, "package")
  mkdirSync(pkgDir, { recursive: true })
  for (const [file, text] of Object.entries(files)) put(pkgDir, file, text)
  const archive = join(root, name + ".tgz")
  execFileSync("tar", ["-czf", archive, "-C", stage, "package"])
  return archive
}

test("#335: comparePackedDeclarations materializes tarballs outside workspace and catches payload differences masked by workspace dist/", () => {
  const root = mkdtempSync(join(tmpdir(), "packed-decl-api-"))
  try {
    // Workspace dist/ matches baseline identically, while candidate tarball ships a mutated .d.ts.
    const manifest = JSON.stringify({
      name: "@fixture/packed-sdk",
      version: "1.0.0",
      type: "module",
      exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } }
    })
    const baselineArchive = makeTarball(root, "baseline", {
      "package.json": manifest,
      "dist/index.js": "export const answer = 42;\n",
      "dist/index.d.ts": "export declare const answer: 42;\n"
    })
    const sameArchive = makeTarball(root, "same", {
      "package.json": manifest,
      "dist/index.js": "export const answer = 42;\n",
      "dist/index.d.ts": "export declare const answer: 42;\n"
    })
    const mutatedArchive = makeTarball(root, "mutated", {
      "package.json": manifest,
      "dist/index.js": "export const answer = 42;\n",
      "dist/index.d.ts": "export declare const answer: string;\n"
    })

    const identical = comparePackedDeclarations(ts, baselineArchive, sameArchive)
    assert.equal(identical.comparisonComplete, true, JSON.stringify(identical))
    assert.equal(identical.identical, true, JSON.stringify(identical))

    const diff = comparePackedDeclarations(ts, baselineArchive, mutatedArchive)
    assert.equal(diff.comparisonComplete, true, JSON.stringify(diff))
    assert.equal(diff.identical, false, JSON.stringify(diff))
    assert.ok(diff.typeDifferences.length > 0, JSON.stringify(diff))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#335: comparePackedDeclarations refuses sidecar targets and missing packed declarations without workspace fallback", () => {
  const root = mkdtempSync(join(tmpdir(), "packed-decl-refuse-"))
  try {
    const baseManifest = JSON.stringify({
      name: "@fixture/packed-sdk",
      version: "1.0.0",
      type: "module",
      exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } }
    })
    const baselineArchive = makeTarball(root, "baseline", {
      "package.json": baseManifest,
      "dist/index.js": "export const answer = 42;\n",
      "dist/index.d.ts": "export declare const answer: 42;\n"
    })
    // Candidate tarball omits dist/index.d.ts and tries to point at a sidecar or missing file.
    const sidecarArchive = makeTarball(root, "sidecar", {
      "package.json": JSON.stringify({
        name: "@fixture/packed-sdk",
        version: "1.0.0",
        type: "module",
        exports: { ".": { types: "./src/index.d.vibe.ts", default: "./dist/index.js" } }
      }),
      "dist/index.js": "export const answer = 42;\n"
    })
    const refused = comparePackedDeclarations(ts, baselineArchive, sidecarArchive)
    assert.equal(refused.identical, false)
    assert.equal(refused.comparisonComplete, false)
    assert.ok(refused.environmentDiagnostics.some(d => /sidecar|missing/i.test(d.diagnostic)), JSON.stringify(refused))

    // materializePackArchive rejects traversal outside destination.
    const extracted = join(root, "out")
    const materialized = materializePackArchive(baselineArchive, extracted)
    assert.ok(materialized.files.includes("dist/index.d.ts"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#410: packRepository and comparePacks enforce the public export-map condition contract and flag added vibelang-source conditions", async () => {
  const root = mkdtempSync(join(tmpdir(), "export-map-contract-"))
  try {
    const pkg = join(root, "pkg")
    const baseManifest = {
      name: "@fixture/contract",
      version: "1.0.0",
      type: "module",
      files: ["dist"],
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }
      }
    }
    put(pkg, "package.json", JSON.stringify(baseManifest, null, 2) + "\n")
    put(pkg, "dist/index.js", "export const x = 1\n")
    put(pkg, "dist/index.d.ts", "export declare const x: 1;\n")
    const before = await packRepository({ target: pkg, packages: [{ dir: "." }], packer: "npm" }, join(root, "before"))
    assert.deepEqual(before.packages["."].exportConditions, { ".": ["types", "import"] })
    assert.deepEqual(before.packages["."].sourceConditions, [])

    // Adding an unapproved vibelang-source condition to the published export map must fail comparePacks.
    const mutatedManifest = {
      ...baseManifest,
      exports: {
        ".": { types: "./dist/index.d.ts", "vibelang-source": "./src/index.vibe", import: "./dist/index.js" }
      }
    }
    put(pkg, "package.json", JSON.stringify(mutatedManifest, null, 2) + "\n")
    const after = await packRepository({ target: pkg, packages: [{ dir: "." }], packer: "npm" }, join(root, "after"))
    assert.deepEqual(after.packages["."].exportConditions, { ".": ["types", "vibelang-source", "import"] })
    assert.ok(after.packages["."].sourceConditions.length > 0)

    const verdict = comparePacks(before, after)
    assert.equal(verdict.ok, false, JSON.stringify(verdict))
    assert.ok(verdict.packages["."].sourceConditions.length > 0, JSON.stringify(verdict))
    assert.ok(verdict.packages["."].conditionChanges.length > 0, JSON.stringify(verdict))

    // exportConditionSurface also detects direct .vibe targets in published exports.
    const surface = exportConditionSurface({
      exports: { "./sub": { types: "./dist/sub.d.ts", default: "./src/sub.vibe" } }
    })
    assert.ok(surface.sourceConditions.length > 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
