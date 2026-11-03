import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
function fixture(before, after, run) {
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
    }
    return run(join(root, "before"), join(root, "after"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const compare = (before, after) => fixture(before, after, (a, b) => compareApiIdentity(ts, a, b))
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

test("ambient environments cannot merge changed globals, scripts, dependencies or module augmentations", () => {
  for (const [before, after] of [
    [global(), global("x: string; y: number;")],
    [referenced("x: string;"), referenced("x: string; y: number;")],
    [inherited("x: string;"), inherited("x: string; y: number;")],
    [augmented("y: number;"), augmented("y: number; z: boolean;")],
  ]) unavailable(compare(before, after))
  assert.equal(compare(global(), global()).identical, true)
  assert.equal(compare(augmented("y: number;"), augmented("y: number;")).identical, true)
})

test("ambient documentation is isolated through dependency closures and whitespace is normalized", () => {
  const documented = text => `\n/** ${text} */\nx: string;\n`
  for (const shape of [global, inherited, augmented]) {
    unavailable(compare(shape(documented("Old docs")), shape(documented("New docs"))))
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
        assert.equal(compareApiIdentity(ts, a, a).identical, true)
        unavailable(compareApiIdentity(ts, a, b))
      })
    },
  })
})
