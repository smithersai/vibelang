import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./api-identity-corpus/smithers-physical-sidecar-import.json", import.meta.url)))
function fixture(before, after, fn) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-physical-sidecar-"))
  try {
    for (const [side, files] of Object.entries({ before, after })) {
      for (const [name, text] of Object.entries(files)) {
        const file = join(root, "snapshots", side, "pkg", name)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, text)
      }
    }
    return fn(join(root, "snapshots/before/pkg"), join(root, "snapshots/after/pkg"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
function validPhysical(dir, file) {
  const program = ts.createProgram([join(dir, file)], { strict: true, noEmit: true, types: [],
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowArbitraryExtensions: true, allowImportingTsExtensions: true })
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => ({
    code: d.code, text: ts.flattenDiagnosticMessageText(d.messageText, "\n")
  })), [], "stock tsc must accept the original physical declaration")
}
function identical(before, after) {
  const result = compareApiIdentity(ts, before, after, { moduleRoots: [] })
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
  return result
}
test("Smithers physical sidecar imports resolve from their compiler-emitted mirror path", () => {
  fixture(corpus.before, corpus.after, (before, after) => {
    validPhysical(before, "src/A.d.ts")
    validPhysical(after, ".vibe/declarations/src/A.d.vibe.ts")
    identical(before, after)
    identical(after, after)
  })
})
test("physical sidecar resolution does not fall back to a valid but wrong logical import", () => {
  const after = { ...corpus.after }
  // From the projected source path the same specifier reaches this sibling;
  // stock tsc at the physical path still selects the real package dependency.
  fixture(corpus.before, after, (before, candidate) => {
    const decoy = join(candidate, "../..", "src/B.d.ts")
    mkdirSync(dirname(decoy), { recursive: true })
    writeFileSync(decoy, "export interface B { readonly x: string }")
    validPhysical(candidate, ".vibe/declarations/src/A.d.vibe.ts")
    identical(before, candidate)
  })
})
test("a semantic change reached through a physical sidecar remains a type difference", () => {
  fixture(corpus.before, { ...corpus.after, "src/B.d.ts": "export interface B { readonly x: string }" }, (before, after) => {
    validPhysical(after, ".vibe/declarations/src/A.d.vibe.ts")
    const result = compareApiIdentity(ts, before, after, { moduleRoots: [] })
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.equal(result.identical, false)
    assert.ok(result.typeDifferences.some(d => d.export === "a" && /TS2344/.test(d.diagnostic)), JSON.stringify(result))
  })
})
test("missing dependencies of physical sidecars remain unavailable", () => {
  const after = { ...corpus.after }
  delete after["src/B.d.ts"]
  fixture(corpus.before, after, (before, candidate) => {
    const result = compareApiIdentity(ts, before, candidate, { moduleRoots: [] })
    assert.equal(result.comparisonComplete, false, JSON.stringify(result))
    assert.equal(result.identical, false)
    assert.deepEqual(result.typeDifferences, [])
    assert.ok(result.environmentDiagnostics.some(d => /TS2307/.test(d.diagnostic)), JSON.stringify(result))
  })
})
test("property: changing a sidecar mirror's depth preserves self and twin identity, not type mutations", async () => {
  await checkProperty(fc, {
    name: "api-identity-physical-sidecar-imports",
    rule: "Will: each exported type must match stock tsc; a projected sidecar retains the physical declaration's import resolution.",
    command: "node --test scripts/api-identity-sidecar-imports.test.mjs",
    arbitrary: fc.record({ depth: fc.integer({ min: 1, max: 4 }), value: fc.integer({ min: 0, max: 1000 }), inline: fc.boolean() }),
    numRuns: 8,
    check: ({ depth, value, inline }) => {
      const mirror = Array.from({ length: depth }, (_, i) => i ? "nested" + i : ".decls").join("/")
      const path = mirror + "/src/A.d.vibe.ts"
      const specifier = relative(dirname(path), "src/B.ts").replaceAll("\\", "/")
      const statement = name => inline
        ? 'export declare const a: import("' + name + '").B;'
        : 'import type { B } from "' + name + '"; export declare const a: B;'
      const before = { ...corpus.before, "src/B.d.ts": "export interface B { readonly x: " + value + " }", "src/A.d.ts": statement("./B.ts") }
      const after = { "package.json": corpus.after["package.json"], "tsconfig.json": JSON.stringify({ vibe: { sidecarDir: mirror } }),
        "src/B.d.ts": before["src/B.d.ts"], [path]: statement(specifier) }
      fixture(before, after, (a, b) => {
        validPhysical(b, path)
        identical(a, b)
        identical(b, b)
        writeFileSync(join(b, "src/B.d.ts"), "export interface B { readonly x: " + (value + 1) + " }")
        const result = compareApiIdentity(ts, a, b, { moduleRoots: [] })
        assert.equal(result.comparisonComplete, true, JSON.stringify(result))
        assert.ok(result.typeDifferences.some(d => d.export === "a"), JSON.stringify(result))
      })
    }
  })
})

test("real beside-source declarations take precedence over stale mirrored declarations", () => {
  const after = { ...corpus.after,
    "src/A.d.vibe.ts": corpus.before["src/A.d.ts"],
    ".vibe/declarations/src/A.d.vibe.ts": 'export declare const a: "stale";' }
  fixture(corpus.before, after, (before, candidate) => {
    validPhysical(candidate, "src/A.d.vibe.ts")
    identical(before, candidate)
  })
})

test("inherited sidecar directories retain physical import resolution outside the package", () => {
  const after = { ...corpus.after,
    "tsconfig.json": '{"extends":"../base.json"}',
    "../base.json": '{"vibe":{"sidecarDir":".decls"}}',
    "../.decls/src/A.d.vibe.ts": 'import type { B } from "../../pkg/src/B.ts"; export declare const a: B;' }
  delete after[".vibe/declarations/src/A.d.vibe.ts"]
  fixture(corpus.before, after, (before, candidate) => {
    validPhysical(candidate, "../.decls/src/A.d.vibe.ts")
    identical(before, candidate)
    identical(candidate, candidate)
  })
})
