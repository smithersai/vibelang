import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"
import { createEs5FixtureGuard } from "./testing/fixture-libraries.mjs"

const { ts, assertLibraries } = createEs5FixtureGuard(loadTypeScript(), "Ambient declaration fixtures")
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
const compilerOptions = { lib: ["lib.es5.d.ts"] }
const nativeOptions = { ...compilerOptions, strict: true, noEmit: true, types: [],
  module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler }
function fixture(before, after, run, diagnosticCodes = []) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-ambient-"))
  try {
    for (const [side, input] of Object.entries({ before, after })) {
      mkdirSync(join(root, side), { recursive: true })
      for (const [file, text] of Object.entries(typeof input === "string" ? { "index.d.ts": input } : input)) {
        const target = join(root, side, file)
        mkdirSync(join(target, ".."), { recursive: true })
        writeFileSync(target, text)
      }
      writeFileSync(join(root, side, "package.json"), JSON.stringify({ types: "index.d.ts" }))
      const program = ts.createProgram([join(root, side, "index.d.ts")], nativeOptions)
      assertLibraries()
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), diagnosticCodes,
        "stock TypeScript validates each ambient closure in a separate program")
    }
    return run(join(root, "before"), join(root, "after"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const compare = (before, after) => fixture(before, after, (a, b) => guardedCompare(a, b))
function unavailable(result) {
  assert.equal(result.identical, false, JSON.stringify(result))
  assert.equal(result.comparisonComplete, false, JSON.stringify(result))
  assert.deepEqual(result.typeDifferences, [])
  assert.ok(result.environmentDiagnostics.some(d => d.blocking && /Ambient declaration closures differ/.test(d.diagnostic)), JSON.stringify(result))
}
const global = (members = "x: string;") => `declare global { interface IdentityGlobal { ${members} } } export type X = IdentityGlobal;`
const referenced = members => ({
  "index.d.ts": '/// <reference path="./global.d.ts" />\nexport type X = IdentityScriptGlobal;',
  "global.d.ts": `interface IdentityScriptGlobal { ${members} }`,
})
const inherited = members => ({
  "index.d.ts": 'import "./augment"; export type X = IdentityInheritedGlobal;',
  "augment.d.ts": 'import type { Fields } from "./fields"; declare global { interface IdentityInheritedGlobal extends Fields {} } export {};',
  "fields.d.ts": `export interface Fields { ${members} }`,
})
const augmented = members => ({
  "index.d.ts": 'import "./augment"; import type { Foreign } from "foreign"; export type X = Foreign;',
  "augment.d.ts": `import "foreign"; declare module "foreign" { interface Foreign { ${members} } }`,
  "node_modules/foreign/package.json": JSON.stringify({ name: "foreign", version: "1.0.0", types: "index.d.ts" }),
  "node_modules/foreign/index.d.ts": "export interface Foreign { x: string }",
})

function differentTypes(result) {
  assert.equal(result.identical, false, JSON.stringify(result))
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.ok(result.typeDifferences.length, JSON.stringify(result))
}
test("ambient globals and scripts compare independently; module augmentations still fail closed", () => {
  for (const [before, after] of [
    [global(), global("x: string; y: number;")],
    [referenced("x: string;"), referenced("x: string; y: number;")],
    [inherited("x: string;"), inherited("x: string; y: number;")],
  ]) differentTypes(compare(before, after))
  unavailable(compare(augmented("y: number;"), augmented("y: number; z: boolean;")))
  assert.equal(compare(global(), global()).identical, true)
  assert.equal(compare(augmented("y: number;"), augmented("y: number;")).identical, true)
})

test("ambient documentation is isolated through dependency closures and whitespace is normalized", () => {
  const documented = text => `\n/** ${text} */\nx: string;\n`
  for (const shape of [global, inherited, augmented]) {
    const changed = compare(shape(documented("Old docs")), shape(documented("New docs")))
    if (shape === augmented) unavailable(changed)
    else {
      assert.equal(changed.comparisonComplete, true, JSON.stringify(changed))
      assert.ok(changed.docDifferences.length, JSON.stringify(changed))
    }
    assert.equal(compare(shape(documented("Same docs")), shape(documented("Same\n * docs"))).identical, true)
  }
})

test("property: ambient packages compare with themselves and semantic mutations never pass", async () => {
  await checkProperty(fc, {
    name: "api-identity-ambient-reflexivity",
    rule: "Published declarations preserve exported types and comments; shared ambient globals cannot mask a mutation.",
    command: "node --test scripts/api-identity-ambient.test.mjs",
    arbitrary: fc.record({ literal: fc.integer({ min: 0, max: 1000 }), kind: fc.constantFrom("global", "script", "inherited") }),
    numRuns: 4,
    check: ({ literal, kind }) => {
      const shape = { global, script: referenced, inherited }[kind]
      const before = shape(`x: ${literal};`), after = shape(`x: ${literal}; changed: number;`)
      fixture(before, after, (a, b) => {
        assert.equal(guardedCompare(a, a).identical, true)
        differentTypes(guardedCompare(a, b))
      })
    },
  })
})

function guardedCompare(before, after) {
  const result = compareApiIdentity(ts, before, after, { compilerOptions })
  assertLibraries()
  return result
}

test("ambient fixture libraries retain native missing BigInt errors", () => {
  const source = global("x: BigInt;")
  fixture(source, source, (before, after) => {
    const result = guardedCompare(before, after)
    assert.equal(result.identical, false, JSON.stringify(result))
    assert.equal(result.comparisonComplete, false, JSON.stringify(result))
    assert.ok(result.environmentDiagnostics.some(d => /TS2583/.test(d.diagnostic)), JSON.stringify(result))
    assert.ok(result.environmentDiagnostics.some(d => d.blocking), JSON.stringify(result))
  }, [2583])
})

test("independent native programs retain conflicting global property types", () => {
  fixture(global("x: string;"), global("x: number;"), (before, after) => {
    for (const [dir, primitive] of [[before, "string"], [after, "number"]]) {
      const file = join(dir, "consumer.ts")
      writeFileSync(file, 'import type { X } from "./index.js"; declare const value: X; const same: '+primitive+
        '=value.x; const different: '+(primitive === "string" ? "number" : "string")+'=value.x;')
      const program = ts.createProgram([file], nativeOptions)
      assertLibraries()
      assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.code), [2322])
    }
    differentTypes(guardedCompare(before, after))
  })
})
