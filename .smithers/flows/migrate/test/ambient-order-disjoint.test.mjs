import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "../../../../scripts/api-identity.mjs"

const ts = loadTypeScript()
const put = (root, file, text) => {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

function setupAmbientPkg(side, name, content) {
  put(side, `node_modules/${name}/package.json`, JSON.stringify({ name, version: "1.0.0", types: "index.d.ts" }))
  put(side, `node_modules/${name}/index.d.ts`, content)
}

test("#390: disjoint ambient declarations loaded in different order complete comparison cleanly", () => {
  const root = mkdtempSync(join(tmpdir(), "ambient-disjoint-order-"))
  try {
    const before = join(root, "before")
    const after = join(root, "after")
    const pkgA = 'declare global { interface AlphaGlobal { readonly alpha: string } }\nexport interface AlphaValue { readonly a: AlphaGlobal }\n'
    const pkgB = 'declare module "beta-virtual" { export interface BetaValue { readonly beta: number } }\nexport interface BetaHolder { readonly b: string }\n'
    for (const side of [before, after]) {
      setupAmbientPkg(side, "pkg-alpha", pkgA)
      setupAmbientPkg(side, "pkg-beta", pkgB)
      put(side, "package.json", JSON.stringify({ name: "journal-fixture", type: "module", types: "./index.d.ts", exports: { ".": "./index.d.ts" } }))
      put(side, "tsconfig.json", JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, types: [], target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true },
        files: ["index.d.ts"]
      }))
    }
    // Original loads pkg-alpha then pkg-beta; converted loads pkg-beta then pkg-alpha.
    put(before, "index.d.ts", 'import type { AlphaValue } from "pkg-alpha";\nimport type { BetaHolder } from "pkg-beta";\nexport declare const journal: { readonly a: AlphaValue; readonly b: BetaHolder };\n')
    put(after, "index.d.ts", 'import type { BetaHolder } from "pkg-beta";\nimport type { AlphaValue } from "pkg-alpha";\nexport declare const journal: { readonly a: AlphaValue; readonly b: BetaHolder };\n')

    const same = compareApiIdentity(ts, before, after, {})
    assert.equal(same.comparisonComplete, true, JSON.stringify(same))
    assert.equal(same.identical, true, JSON.stringify(same))

    // A genuine API change under reordered disjoint ambient inputs is still caught.
    put(after, "index.d.ts", 'import type { BetaHolder } from "pkg-beta";\nimport type { AlphaValue } from "pkg-alpha";\nexport declare const journal: { readonly a: AlphaValue; readonly b: string };\n')
    const diff = compareApiIdentity(ts, before, after, {})
    assert.equal(diff.comparisonComplete, true, JSON.stringify(diff))
    assert.equal(diff.identical, false, JSON.stringify(diff))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#390: overlapping ambient overload declarations loaded in different order still refuse", () => {
  const root = mkdtempSync(join(tmpdir(), "ambient-overlapping-order-"))
  try {
    const before = join(root, "before")
    const after = join(root, "after")
    const first = 'declare global { interface SharedAug { fn(x: string): 1 } }\nexport interface First { readonly f: 1 }\n'
    const second = 'declare global { interface SharedAug { fn(x: string): 2 } }\nexport interface Second { readonly s: 2 }\n'
    for (const side of [before, after]) {
      setupAmbientPkg(side, "pkg-first", first)
      setupAmbientPkg(side, "pkg-second", second)
      put(side, "package.json", JSON.stringify({ name: "overlap-fixture", type: "module", types: "./index.d.ts", exports: { ".": "./index.d.ts" } }))
      put(side, "tsconfig.json", JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, types: [], target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true },
        files: ["index.d.ts"]
      }))
    }
    put(before, "index.d.ts", 'import type { First } from "pkg-first";\nimport type { Second } from "pkg-second";\nexport declare const result: ReturnType<SharedAug["fn"]> | First | Second;\n')
    put(after, "index.d.ts", 'import type { Second } from "pkg-second";\nimport type { First } from "pkg-first";\nexport declare const result: ReturnType<SharedAug["fn"]> | First | Second;\n')

    const res = compareApiIdentity(ts, before, after, {})
    assert.equal(res.comparisonComplete, false, JSON.stringify(res))
    assert.ok(res.environmentDiagnostics.some(d => d.diagnostic.startsWith("Ambient declaration load order differs")), JSON.stringify(res))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
